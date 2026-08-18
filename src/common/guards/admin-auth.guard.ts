import {
	CanActivate,
	ExecutionContext,
	Injectable,
	Logger,
	UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

/**
 * Общий guard для внутренних/административных ручек (управление подпиской на
 * вебхуки СДЕК, принудительный релогин в Megagroup и т.п.) — то, что должны
 * дёргать только вы сами, а не кто угодно из интернета, раз сервер публично
 * доступен ради приёма вебхуков СДЕК.
 *
 * Сверяет заголовок x-admin-token с ADMIN_API_TOKEN из .env. Сравнение через
 * хэш + timingSafeEqual, чтобы не давать по времени ответа утечку о том,
 * сколько символов токена угадано верно.
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
	private readonly logger = new Logger(AdminAuthGuard.name);

	constructor(private readonly configService: ConfigService) {}

	canActivate(context: ExecutionContext): boolean {
		const request = context.switchToHttp().getRequest<Request>();
		const expectedToken = this.configService.getOrThrow<string>('ADMIN_API_TOKEN');
		const providedToken = request.headers['x-admin-token'];

		if (!providedToken || typeof providedToken !== 'string') {
			this.logger.warn(
				`Запрос на ${request.method} ${request.path} без x-admin-token — отклонён`,
			);
			throw new UnauthorizedException('Missing admin token');
		}

		const expectedHash = createHash('sha256').update(expectedToken).digest();
		const providedHash = createHash('sha256').update(providedToken).digest();

		if (!timingSafeEqual(expectedHash, providedHash)) {
			this.logger.warn(
				`Запрос на ${request.method} ${request.path} с неверным x-admin-token — отклонён`,
			);
			throw new UnauthorizedException('Invalid admin token');
		}

		return true;
	}
}
