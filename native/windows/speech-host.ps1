param([switch]$Silent)
$ErrorActionPreference = 'Stop'
try {
    $speechSource = Join-Path -Path $PSScriptRoot -ChildPath 'SpeechHost.cs'
    $playbackSource = Join-Path -Path $PSScriptRoot -ChildPath 'PcmPlayback.cs'
    Add-Type -Path @($speechSource, $playbackSource) -ReferencedAssemblies 'System.Speech', 'System.Web.Extensions', 'System.Core'
    [ReaderSpeechHost]::Run($Silent.IsPresent)
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
