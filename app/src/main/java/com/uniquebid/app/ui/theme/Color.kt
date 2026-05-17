package com.uniquebid.app.ui.theme

import androidx.compose.ui.graphics.Color

// Kalki Bet brand palette — dark navy + electric blue, matched to the
// horse-mascot logo's silver-on-navy with cyan highlights.
//
// (Variable names retain the legacy "Indigo"/"Gold" naming so the hundreds of
// call sites don't need to change; only the hex values shift.)
val BrandIndigo = Color(0xFF0F1735)        // hero blue/navy
val BrandIndigoDark = Color(0xFF070A1A)    // background navy
val BrandGold = Color(0xFF4A8FFF)          // electric blue accent
val BrandGoldLight = Color(0xFF8FB8FF)     // lighter accent

// Bid status semantic colors (unchanged).
val StatusWinning = Color(0xFF22C55E)
val StatusWarning = Color(0xFFF59E0B)
val StatusLosing = Color(0xFFEF4444)

// Surface tints — darker, less purple.
val SurfaceDark = Color(0xFF0A0F1F)
val SurfaceDarkElevated = Color(0xFF141A30)
val SurfaceLight = Color(0xFFFAF8FF)
val SurfaceLightElevated = Color(0xFFFFFFFF)
