import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
	const app = await NestFactory.create(AppModule);

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
