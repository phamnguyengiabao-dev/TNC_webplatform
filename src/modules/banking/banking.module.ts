import { Module } from '@nestjs/common';

import { BankingService } from './banking.service';
import { LedgerService } from './ledger.service';

/** Money core. Nothing else may write to Wallet/LedgerTransfer/LedgerEntry. */
@Module({
  providers: [LedgerService, BankingService],
  exports: [LedgerService, BankingService],
})
export class BankingModule {}
