package com.uniquebid.app.ui.navigation

import androidx.compose.runtime.Composable
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.uniquebid.app.ui.screens.auctions.AuctionsWebScreen
import com.uniquebid.app.ui.screens.auth.LoginScreen
import com.uniquebid.app.ui.screens.auth.RegisterScreen
import com.uniquebid.app.ui.screens.aviator.AviatorScreen
import com.uniquebid.app.ui.screens.bet.BetScreen
import com.uniquebid.app.ui.screens.hub.HubScreen
import com.uniquebid.app.ui.screens.notifications.NotificationsScreen
import com.uniquebid.app.ui.screens.profile.ProfileScreen
import com.uniquebid.app.ui.screens.splash.SplashScreen
import com.uniquebid.app.ui.screens.wallet.WalletScreen

/**
 * Top-level navigation. Three game surfaces (Auctions, Aviator, Bet) all
 * route to a WebView screen — the Android app is intentionally thin:
 * it owns auth + the hub + the wallet, every product surface lives on
 * the web (Next.js apps on :3000 / :3100). The hub-tab callbacks below
 * are wired to those WebView destinations.
 */
@Composable
fun UniqueBidNavGraph() {
    val nav = rememberNavController()
    NavHost(navController = nav, startDestination = Route.Splash.path) {
        composable(Route.Splash.path) {
            SplashScreen(
                onAuthenticated = {
                    nav.navigate(Route.Hub.path) {
                        popUpTo(Route.Splash.path) { inclusive = true }
                    }
                },
                onUnauthenticated = {
                    nav.navigate(Route.Login.path) {
                        popUpTo(Route.Splash.path) { inclusive = true }
                    }
                },
            )
        }
        composable(Route.Login.path) {
            LoginScreen(
                onLoginSuccess = {
                    nav.navigate(Route.Hub.path) {
                        popUpTo(Route.Login.path) { inclusive = true }
                    }
                },
                onRegisterClick = { nav.navigate(Route.Register.path) },
            )
        }
        composable(Route.Register.path) {
            RegisterScreen(
                onRegistered = {
                    nav.navigate(Route.Hub.path) {
                        popUpTo(Route.Login.path) { inclusive = true }
                    }
                },
                onBack = { nav.popBackStack() },
            )
        }
        composable(Route.Hub.path) {
            HubScreen(
                onLiveAuctions = { nav.navigate(Route.Auctions.path) },
                onAviator = { nav.navigate(Route.Aviator.path) },
                onBet = { nav.navigate(Route.Bet.path) },
                onWallet = { nav.navigate(Route.Wallet.path) },
                onNotifications = { nav.navigate(Route.Notifications.path) },
                onProfile = { nav.navigate(Route.Profile.path) },
            )
        }
        composable(Route.Auctions.path) {
            AuctionsWebScreen(onBack = { nav.popBackStack() })
        }
        composable(Route.Aviator.path) {
            AviatorScreen(onBack = { nav.popBackStack() })
        }
        composable(Route.Bet.path) {
            BetScreen(onBack = { nav.popBackStack() })
        }
        composable(Route.Wallet.path) {
            WalletScreen(onBack = { nav.popBackStack() })
        }
        composable(Route.Notifications.path) {
            NotificationsScreen(
                onBack = { nav.popBackStack() },
                onWalletClick = { nav.navigate(Route.Wallet.path) },
            )
        }
        composable(Route.Profile.path) {
            ProfileScreen(
                onBack = { nav.popBackStack() },
                onWalletClick = { nav.navigate(Route.Wallet.path) },
                onLoggedOut = {
                    nav.navigate(Route.Login.path) {
                        popUpTo(0) { inclusive = true }
                    }
                },
            )
        }
    }
}
