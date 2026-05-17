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

data class RegisterUiState(
    val email: String = "",
    val username: String = "",
    val password: String = "",
    val submitting: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class RegisterViewModel @Inject constructor(
    private val auth: AuthRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(RegisterUiState())
    val state: StateFlow<RegisterUiState> = _state.asStateFlow()

    fun onEmail(v: String) { _state.value = _state.value.copy(email = v, error = null) }
    fun onUsername(v: String) { _state.value = _state.value.copy(username = v, error = null) }
    fun onPassword(v: String) { _state.value = _state.value.copy(password = v, error = null) }

    fun submit(onSuccess: () -> Unit) {
        val s = _state.value
        val err = validate(s)
        if (err != null) {
            _state.value = s.copy(error = err)
            return
        }
        viewModelScope.launch {
            _state.value = s.copy(submitting = true, error = null)
            try {
                auth.register(s.email.trim(), s.username.trim(), s.password)
                onSuccess()
            } catch (e: HttpException) {
                _state.value = _state.value.copy(submitting = false, error = errorFor(e))
            } catch (e: Throwable) {
                _state.value = _state.value.copy(submitting = false, error = e.message ?: "register failed")
            }
        }
    }

    private fun validate(s: RegisterUiState): String? = when {
        s.email.isBlank() -> "email required"
        !s.username.matches(Regex("^[a-zA-Z0-9_]{3,20}$")) ->
            "username must be 3–20 chars (letters, digits, underscore)"
        s.password.length < 8 -> "password must be 8+ chars"
        else -> null
    }

    private fun errorFor(e: HttpException) = when (e.code()) {
        409 -> "email or username already in use"
        else -> "register failed (${e.code()})"
    }
}
