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
import { MegagroupModule } from './megagroup/megagroup.module';

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

				REDIS_HOST: Joi.string().required(),
				REDIS_PORT: Joi.number().default(6379),
				REDIS_PASSWORD: Joi.string().allow('').optional(),
			}),
		}),
		CacheModule.registerAsync({
			isGlobal: true,
			imports: [ConfigModule],
			inject: [ConfigService],
			useFactory: (configService: ConfigService) => {
				const host = configService.get<string>('REDIS_HOST');
				const port = configService.get<number>('REDIS_PORT');
				const password = configService.get<string>('REDIS_PASSWORD');

				// Формируем стандартную строку подключения к Redis
				const auth = password ? `default:${password}@` : '';
				const redisUrl = `redis://${auth}${host}:${port}`;

				return {
					store: createKeyv(redisUrl),
				};
			},
		}),
		BullModule.forRootAsync({
			imports: [ConfigModule],
			inject: [ConfigService],
			useFactory: (configService: ConfigService) => ({
				connection: {
					host: configService.get<string>('REDIS_HOST'),
					port: configService.get<number>('REDIS_PORT'),
					password: configService.get<string>('REDIS_PASSWORD'),
				},
			}),
		}),
		HttpModule,
		MegagroupModule,
		CdekModule,
	],
	controllers: [AppController],
	providers: [AppService],
})
export class AppModule {}
