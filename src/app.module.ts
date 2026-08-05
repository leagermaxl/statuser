import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import Joi from 'joi';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
	imports: [
		ConfigModule.forRoot({
			isGlobal: true,
			validationSchema: Joi.object({
				PORT: Joi.number().default(3000),
				NODE_ENV: Joi.string()
					.valid('development', 'production', 'test')
					.default('development'),

				MEGAGROUP_LOGIN: Joi.string().required(),
				MEGAGROUP_PASSWORD: Joi.string().required(),
				MEGAGROUP_ADMIN_URL: Joi.string().uri().required(),

				CDEK_WEBHOOK_SECRET: Joi.string().required(),
			}),
		}),
		HttpModule,
	],
	controllers: [AppController],
	providers: [AppService],
})
export class AppModule {}
