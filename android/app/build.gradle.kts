plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// server address: gradle.properties (kabootarUrl) or the KABOOTAR_URL environment variable
val serverUrl: String = (System.getenv("KABOOTAR_URL")?.takeIf { it.isNotBlank() }
    ?: (project.findProperty("kabootarUrl") as String?) ?: "https://kabootar.up.railway.app").trimEnd('/')

android {
    namespace = "app.kabootar"
    compileSdk = 34

    defaultConfig {
        applicationId = "app.kabootar"
        minSdk = 26
        targetSdk = 34
        versionCode = 38
        versionName = "3.8.0"
        buildConfigField("String", "SERVER_URL", "\"$serverUrl\"")
        manifestPlaceholders["serverHost"] = serverUrl.substringAfter("://").substringBefore("/").substringBefore(":")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // signed with the debug key so the APK installs directly; use your own keystore for Play Store
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    lint { checkReleaseBuilds = false; abortOnError = false }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.1")
    implementation("androidx.webkit:webkit:1.11.0")
}
