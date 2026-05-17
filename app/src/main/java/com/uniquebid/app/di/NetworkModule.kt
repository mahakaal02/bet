package com.uniquebid.app.di

import com.squareup.moshi.Moshi
import com.uniquebid.app.BuildConfig
import com.uniquebid.app.data.api.AuthApi
import com.uniquebid.app.data.api.CoinPackApi
import com.uniquebid.app.data.api.PaymentApi
import com.uniquebid.app.data.network.AuthInterceptor
import com.uniquebid.app.data.network.BigDecimalAdapter
import com.uniquebid.app.data.network.InstantAdapter
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory
import java.util.concurrent.TimeUnit
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {

    @Provides
    @Singleton
    fun provideMoshi(): Moshi = Moshi.Builder()
        .add(BigDecimalAdapter())
        .add(InstantAdapter())
        .build()

    @Provides
    @Singleton
    fun provideOkHttpClient(authInterceptor: AuthInterceptor): OkHttpClient {
        val logging = HttpLoggingInterceptor().apply {
            level = if (BuildConfig.DEBUG) HttpLoggingInterceptor.Level.BODY
            else HttpLoggingInterceptor.Level.NONE
        }
        return OkHttpClient.Builder()
            .addInterceptor(authInterceptor)
            .addInterceptor(logging)
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .pingInterval(20, TimeUnit.SECONDS)
            .build()
    }

    @Provides
    @Singleton
    fun provideRetrofit(client: OkHttpClient, moshi: Moshi): Retrofit =
        Retrofit.Builder()
            .baseUrl(BuildConfig.API_BASE_URL)
            .client(client)
            .addConverterFactory(MoshiConverterFactory.create(moshi))
            .build()

    @Provides @Singleton fun provideAuthApi(r: Retrofit): AuthApi = r.create(AuthApi::class.java)
    @Provides @Singleton fun provideCoinPackApi(r: Retrofit): CoinPackApi = r.create(CoinPackApi::class.java)
    @Provides @Singleton fun providePaymentApi(r: Retrofit): PaymentApi = r.create(PaymentApi::class.java)
}
