import { createKeyv } from '@keyv/redis';
import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bullmq';
import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Joi from 'joi';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CdekModule } from './cdek/cdek.module';
import { HealthModule } from './health/health.module';
import { MegagroupModule } from './megagroup/megagroup.module';
import { TelegramModule } from './telegram/telegram.module';

@Module({
	imports: [
		ConfigModule.forRoot({
			isGlobal: true,
			validationSchema: Joi.object({
				PORT: Joi.number().default(3000),
				NODE_ENV: Joi.string()
					.valid('development', 'production', 'test')
					.default('development'),

				ADMIN_API_TOKEN: Joi.string().required(),

				MEGAGROUP_LOGIN: Joi.string().required(),
				MEGAGROUP_PASSWORD: Joi.string().required(),
				MEGAGROUP_SITE_ID: Joi.string().required(),
				MEGAGROUP_CABINET_URL: Joi.string().uri().required(),
				MEGAGROUP_SHOP_ID: Joi.string().required(),

				CDEK_URL: Joi.string().uri().required(),
				CDEK_CLIENT_ID: Joi.string().required(),
				CDEK_CLIENT_SECRET: Joi.string().required(),

				CDEK_WEBHOOK_SECRET: Joi.string().required(),

				// redis:// для локали без TLS, rediss:// для управляемых Redis (Upstash
				// и т.п.), которым TLS обязателен.
				REDIS_URL: Joi.string()
					.uri({ scheme: ['redis', 'rediss'] })
					.required(),

				TELEGRAM_BOT_TOKEN: Joi.string().required(),
				TELEGRAM_CHAT_ID: Joi.string().required(),

				// Внешний урл сервиса для self-ping (см. HealthPingService). На Render
				// можно не задавать — там она приходит сама как RENDER_EXTERNAL_URL.
				SELF_URL: Joi.string().uri().optional(),
			}),
		}),
		CacheModule.registerAsync({
			isGlobal: true,
			imports: [ConfigModule],
			inject: [ConfigService],
			useFactory: (configService: ConfigService) => ({
				store: createKeyv(configService.getOrThrow<string>('REDIS_URL')),
			}),
		}),
		BullModule.forRootAsync({
			imports: [ConfigModule],
			inject: [ConfigService],
			useFactory: (configService: ConfigService) => ({
				// url (а не host/port/password по отдельности) — единственный способ
				// передать BullMQ TLS-подключение (rediss://) без ручной сборки tls-опций:
				// сам ioredis включает TLS по схеме "rediss:" в урле.
				connection: { url: configService.getOrThrow<string>('REDIS_URL') },
			}),
		}),
		HttpModule,
		MegagroupModule,
		CdekModule,
		TelegramModule,
		HealthModule,
	],
	controllers: [AppController],
	providers: [AppService],
})
export class AppModule {}
