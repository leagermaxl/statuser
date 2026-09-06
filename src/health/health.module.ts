import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { HealthPingService } from './health-ping.service';
import { HealthController } from './health.controller';

@Module({
	imports: [HttpModule],
	controllers: [HealthController],
	providers: [HealthPingService],
})
export class HealthModule {}
