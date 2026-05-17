package com.uniquebid.app.ui.screens.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.uniquebid.app.data.repository.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import retrofit2.HttpException
import javax.inject.Inject

data class LoginUiState(
    val email: String = "",
    val password: String = "",
    val submitting: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class LoginViewModel @Inject constructor(
    private val auth: AuthRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(LoginUiState())
    val state: StateFlow<LoginUiState> = _state.asStateFlow()

    fun onEmailChange(v: String) { _state.value = _state.value.copy(email = v, error = null) }
    fun onPasswordChange(v: String) { _state.value = _state.value.copy(password = v, error = null) }

    fun submit(onSuccess: () -> Unit) {
        val s = _state.value
        if (s.email.isBlank() || s.password.length < 8) {
            _state.value = s.copy(error = "enter a valid email and a password (8+ chars)")
            return
        }
        viewModelScope.launch {
            _state.value = s.copy(submitting = true, error = null)
            try {
                auth.login(s.email.trim(), s.password)
                onSuccess()
            } catch (e: HttpException) {
                _state.value = _state.value.copy(submitting = false, error = errorFor(e))
            } catch (e: Throwable) {
                _state.value = _state.value.copy(submitting = false, error = e.message ?: "login failed")
            }
        }
    }

    private fun errorFor(e: HttpException) = when (e.code()) {
        401 -> "invalid email or password"
        else -> "login failed (${e.code()})"
    }
}
