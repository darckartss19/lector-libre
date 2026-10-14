import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "org.lectorlibre.mobile"
    compileSdk = 36
    defaultConfig { minSdk = 24 }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
}

kotlin {
    compilerOptions { jvmTarget = JvmTarget.JVM_1_8 }
}

dependencies {
    implementation("com.google.android.gms:play-services-auth:22.0.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation(project(":tauri-android"))
}

