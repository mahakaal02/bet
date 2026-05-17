package com.uniquebid.app.ui.screens.hub

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountBalanceWallet
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.uniquebid.app.ui.components.CoinChip
import com.uniquebid.app.ui.theme.BrandGold
import com.uniquebid.app.ui.theme.BrandIndigo
import com.uniquebid.app.ui.theme.BrandIndigoDark

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HubScreen(
    onLiveAuctions: () -> Unit,
    onAviator: () -> Unit,
    onBet: () -> Unit,
    onWallet: () -> Unit,
    onNotifications: () -> Unit,
    onProfile: () -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Kalki Bet") },
                actions = {
                    CoinChip(onClick = onWallet)
                    IconButton(onClick = onWallet) {
                        Icon(Icons.Filled.AccountBalanceWallet, contentDescription = "Wallet")
                    }
                    IconButton(onClick = onNotifications) {
                        Icon(Icons.Filled.Notifications, contentDescription = "Notifications")
                    }
                    IconButton(onClick = onProfile) {
                        Icon(Icons.Filled.Person, contentDescription = "Profile")
                    }
                },
            )
        }
    ) { inner ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(inner)
                .padding(horizontal = 20.dp, vertical = 24.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            Text(
                "Choose a game",
                style = MaterialTheme.typography.headlineLarge,
            )

            HubCard(
                title = "Live Auctions",
                subtitle = "Win real products by outsmarting other bidders.",
                gradient = Brush.linearGradient(listOf(BrandIndigo, BrandIndigoDark)),
                accent = BrandGold,
                onClick = onLiveAuctions,
            )

            HubCard(
                title = "Aviator",
                subtitle = "Cash out before the plane crashes. Multiplier rises every tick.",
                gradient = Brush.linearGradient(
                    listOf(Color(0xFFFF4D5A), Color(0xFFFF8C42)),
                ),
                accent = Color(0xFF2EE59D),
                onClick = onAviator,
            )

            HubCard(
                title = "Kalki Exchange",
                subtitle = "Prediction markets. Trade YES/NO on real-world events.",
                gradient = Brush.linearGradient(
                    listOf(Color(0xFF0EA5E9), Color(0xFF1E1B4B)),
                ),
                accent = Color(0xFF22D3EE),
                onClick = onBet,
            )
        }
    }
}

@Composable
private fun HubCard(
    title: String,
    subtitle: String,
    gradient: Brush,
    accent: Color,
    onClick: () -> Unit,
) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(180.dp)
            .clip(RoundedCornerShape(24.dp))
            .background(gradient)
            .clickable(onClick = onClick)
            .padding(24.dp),
    ) {
        Column(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(
                title,
                style = MaterialTheme.typography.headlineMedium.copy(
                    fontWeight = FontWeight.Bold,
                    color = Color.White,
                ),
            )
            Text(
                subtitle,
                style = MaterialTheme.typography.bodyMedium,
                color = Color.White.copy(alpha = 0.85f),
            )
        }
        Box(
            modifier = Modifier
                .align(Alignment.TopEnd)
                .background(accent.copy(alpha = 0.18f), RoundedCornerShape(12.dp))
                .padding(horizontal = 10.dp, vertical = 4.dp),
        ) {
            Text(
                "Play →",
                style = MaterialTheme.typography.labelLarge,
                color = accent,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}
