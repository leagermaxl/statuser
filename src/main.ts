import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { TelegramLogger } from './telegram/telegram.logger';

async function bootstrap() {
	// bufferLogs копит логи бутстрапа до вызова useLogger(), чтобы они тоже
	// прошли через TelegramLogger, а не только логи после старта приложения.
	const app = await NestFactory.create(AppModule, { bufferLogs: true });
	app.useLogger(app.get(TelegramLogger));

	// Без этого Nest не слушает SIGTERM/SIGINT вообще, и onApplicationShutdown
	// (которым @nestjs/bullmq закрывает BullMQ Worker'ы) никогда не вызывается —
	// при рестарте/редеплое активная джоба обрывается на середине, а не
	// доигрывается перед закрытием воркера.
	app.enableShutdownHooks();

	app.useGlobalPipes(
		new ValidationPipe({
			whitelist: true,
			transform: true,
			// forbidNonWhitelisted: true,
		}),
	);

	const config = app.get(ConfigService);
	const port = config.get<number>('PORT');
	const nodeEnv = config.get<string>('NODE_ENV');

	// Swagger поднимаем только вне продакшена — это внутренний вебхук-сервер,
	// незачем светить схему эндпоинтов (включая debug-роуты) наружу в проде.
	if (nodeEnv !== 'production') {
		const swaggerConfig = new DocumentBuilder()
			.setTitle('Statuser API')
			.setDescription('Синхронизация статусов заказов СДЕК -> Megagroup CMS.S3')
			.setVersion('0.0.1')
			.addTag('cdek', 'Приём вебхуков СДЕК и подписка на них')
			.addTag('megagroup', 'Сессия и обновление статусов в админке Megagroup')
			.addApiKey({ type: 'apiKey', name: 'x-admin-token', in: 'header' }, 'admin-token')
			.build();

		const document = SwaggerModule.createDocument(app, swaggerConfig);
		SwaggerModule.setup('docs', app, document);
	}

	await app.listen(port ?? 3000);
}
void bootstrap();
