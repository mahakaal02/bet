package com.uniquebid.app.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext

private val DarkColors = darkColorScheme(
    primary = BrandGold,
    onPrimary = BrandIndigoDark,
    primaryContainer = BrandIndigo,
    onPrimaryContainer = BrandGoldLight,
    secondary = BrandGoldLight,
    background = SurfaceDark,
    onBackground = SurfaceLight,
    surface = SurfaceDark,
    onSurface = SurfaceLight,
    surfaceVariant = SurfaceDarkElevated,
)

private val LightColors = lightColorScheme(
    primary = BrandIndigo,
    onPrimary = SurfaceLight,
    primaryContainer = BrandGoldLight,
    onPrimaryContainer = BrandIndigoDark,
    secondary = BrandGold,
    background = SurfaceLight,
    onBackground = BrandIndigoDark,
    surface = SurfaceLightElevated,
    onSurface = BrandIndigoDark,
)

@Composable
fun UniqueBidTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = false,
    content: @Composable () -> Unit,
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val ctx = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(ctx) else dynamicLightColorScheme(ctx)
        }
        darkTheme -> DarkColors
        else -> LightColors
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = UniqueBidTypography,
        content = content,
    )
}
