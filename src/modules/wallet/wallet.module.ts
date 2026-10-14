import { Module } from '@nestjs/common';

import { BankingModule } from '../banking/banking.module';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

@Module({
  imports: [BankingModule],
  controllers: [WalletController],
  providers: [WalletService],
})
export class WalletModule {}
