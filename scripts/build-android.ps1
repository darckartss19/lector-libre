param([int]$Jobs = 3)

$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
Push-Location $taskRoot
try {
    foreach ($taskVariable in @('JAVA_HOME', 'ANDROID_HOME', 'NDK_HOME')) {
        if (-not [Environment]::GetEnvironmentVariable($taskVariable)) {
            throw "Configura $taskVariable antes de compilar Android."
        }
    }
    $env:CARGO_BUILD_JOBS = [string]$Jobs
    New-Item work -ItemType Directory -Force | Out-Null
    & pnpm build
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo compilar la interfaz.' }
    $taskTargets = [ordered]@{
        'aarch64' = 'arm64-v8a'
        'x86_64' = 'x86_64'
        'i686' = 'x86'
    }
    foreach ($taskTarget in $taskTargets.Keys) {
        $taskLog = Join-Path $taskRoot "work/android-$taskTarget.log"
        & pnpm tauri android build --target $taskTarget --apk --ci *> $taskLog
        $taskExit = $LASTEXITCODE
        $taskText = Get-Content -LiteralPath $taskLog -Raw
        $taskLibrary = Join-Path $taskRoot "src-tauri/target/$taskTarget-linux-android/release/liblector_libre_lib.so"
        if ($taskExit -ne 0 -and -not (
            $taskText -match 'Finished.*release' -and
            $taskText -match 'Failed to create a symbolic link' -and
            (Test-Path -LiteralPath $taskLibrary)
        )) { throw "La compilación falló. Revisa $taskLog." }
        $taskDestination = Join-Path $taskRoot "src-tauri/gen/android/app/src/main/jniLibs/$($taskTargets[$taskTarget])"
        New-Item $taskDestination -ItemType Directory -Force | Out-Null
        $taskCopiedFile = Join-Path $taskDestination 'liblector_libre_lib.so'
        $taskExisting = Get-Item -LiteralPath $taskCopiedFile -ErrorAction SilentlyContinue
        if ($taskExisting -and $taskExisting.LinkType) {
            Remove-Item -LiteralPath $taskCopiedFile
        }
        Copy-Item -LiteralPath $taskLibrary -Destination $taskCopiedFile -Force
    }
    $taskSdk = $env:ANDROID_HOME.Replace('\', '/').Replace(':', '\:')
    Set-Content src-tauri/gen/android/local.properties "sdk.dir=$taskSdk" -Encoding ascii
    $taskLicenses = Join-Path $taskRoot 'src-tauri/gen/android/app/src/main/assets/licenses'
    New-Item $taskLicenses -ItemType Directory -Force | Out-Null
    Copy-Item -LiteralPath LICENSE,THIRD_PARTY_NOTICES.txt -Destination $taskLicenses -Force
    Get-ChildItem src-tauri/icons/android -Directory | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination src-tauri/gen/android/app/src/main/res -Recurse -Force
    }
    Push-Location src-tauri/gen/android
    try {
        & './gradlew.bat' assembleArm64Release assembleUniversalRelease `
            -x rustBuildArm64Release -x rustBuildX86_64Release -x rustBuildX86Release `
            -x rustBuildUniversalRelease '-PtargetList=aarch64,x86_64,i686' `
            '-ParchList=arm64,x86_64,x86' '-PabiList=x86_64,x86' --no-daemon
        if ($LASTEXITCODE -ne 0) { throw 'No se pudieron empaquetar los APK.' }
    } finally { Pop-Location }
    Write-Output 'APK generados en src-tauri/gen/android/app/build/outputs/apk.'
} finally { Pop-Location }
