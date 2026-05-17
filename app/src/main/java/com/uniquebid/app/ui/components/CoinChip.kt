package com.uniquebid.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.uniquebid.app.data.coins.CoinBalanceStore
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.StateFlow
import javax.inject.Inject

/**
 * Small "🪙 {n}" chip surfaced in every screen's top bar so the user can see
 * their balance at a glance. Clickable — typically navigates to the wallet.
 *
 * Pulls from [CoinBalanceStore], which AuthRepository keeps in sync after
 * login / `/auth/me` / logout, WalletViewModel after Razorpay purchase, and
 * BidViewModel after a bid lands.
 */
@HiltViewModel
class CoinChipViewModel @Inject constructor(
    store: CoinBalanceStore,
) : ViewModel() {
    val balance: StateFlow<Int?> = store.balance
}

@Composable
fun CoinChip(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(horizontal = 10.dp, vertical = 4.dp),
    viewModel: CoinChipViewModel = hiltViewModel(),
) {
    val balance by viewModel.balance.collectAsStateWithLifecycle()
    val label = balance?.let { "🪙 $it" } ?: "🪙 —"

    Text(
        text = label,
        style = MaterialTheme.typography.labelLarge,
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.onPrimaryContainer,
        modifier = modifier
            .padding(horizontal = 4.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(MaterialTheme.colorScheme.primaryContainer)
            .clickable(onClick = onClick)
            .padding(contentPadding),
    )
}
