import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { MegagroupController } from './megagroup.controller';
import { MegagroupService } from './megagroup.service';

@Module({
	imports: [HttpModule],
	controllers: [MegagroupController],
	providers: [MegagroupService, AdminAuthGuard],
	exports: [MegagroupService],
})
export class MegagroupModule {}
