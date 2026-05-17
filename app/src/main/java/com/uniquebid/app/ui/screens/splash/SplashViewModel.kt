package com.uniquebid.app.ui.screens.splash

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.uniquebid.app.data.repository.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class SplashViewModel @Inject constructor(
    private val auth: AuthRepository,
) : ViewModel() {

    /**
     * Resolve auth state. Calls `/auth/me` if a token is present so an
     * expired/revoked token drops the user back to login instead of landing
     * them on a broken Home.
     */
    fun resolveAuth(onAuthed: () -> Unit, onUnauthed: () -> Unit) {
        if (!auth.isAuthenticated()) {
            onUnauthed()
            return
        }
        viewModelScope.launch {
            try {
                auth.me()
                onAuthed()
            } catch (_: Throwable) {
                auth.logout()
                onUnauthed()
            }
        }
    }
}
