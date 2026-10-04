import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { RiskModule } from './risk/risk.module';
import { ConsignmentModule } from './consignments/consignments.module';
import { AppraisalModule } from './appraisals/appraisals.module';
import { ItemModule } from './items/items.module';
import { OrderModule } from './orders/orders.module';
import { DeliveryModule } from './deliveries/deliveries.module';
import { TicketModule } from './tickets/tickets.module';
import { RefurbishOverrunModule } from './refurbish-overruns/refurbish-overruns.module';
import { SettlementModule } from './settlements/settlements.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { SeederService, SeederModule } from './seeder/seeder.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type: 'postgres',
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 5432),
        username: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
        database: process.env.DB_NAME || 'furniture',
        autoLoadEntities: true,
        synchronize: true,
        logging: false,
      }),
    }),
    AuthModule,
    RiskModule,
    ConsignmentModule,
    AppraisalModule,
    ItemModule,
    OrderModule,
    DeliveryModule,
    TicketModule,
    RefurbishOverrunModule,
    SettlementModule,
    AnalyticsModule,
    SeederModule,
  ],
})
export class AppModule {
  constructor(private readonly seeder: SeederService) {}

  async onApplicationBootstrap() {
    if ((process.env.SEED_ON_BOOT || 'true') === 'true') {
      await this.seeder.seed();
    }
  }
}
