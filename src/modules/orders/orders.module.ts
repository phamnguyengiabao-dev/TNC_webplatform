import { Module } from '@nestjs/common';

import { BankingModule } from '../banking/banking.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [BankingModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
