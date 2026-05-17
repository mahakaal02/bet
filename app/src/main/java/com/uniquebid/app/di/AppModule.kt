package com.uniquebid.app.di

import com.uniquebid.app.data.repository.AuthRepository
import com.uniquebid.app.data.repository.PaymentRepository
import com.uniquebid.app.data.repository.RealAuthRepository
import com.uniquebid.app.data.repository.RealPaymentRepository
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Top-level Hilt bindings. The native AuctionRepository / BidRepository /
 * BidStatusSocket bindings were removed when the auctions UI moved to
 * the web (`/auctions` served by the Bet Next.js app at :3100) — no
 * native Android code talks to those backend endpoints anymore.
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class AppModule {

    @Binds
    @Singleton
    abstract fun bindAuthRepository(impl: RealAuthRepository): AuthRepository

    @Binds
    @Singleton
    abstract fun bindPaymentRepository(impl: RealPaymentRepository): PaymentRepository
}
