/**
 * Ответ СДЕК на создание заказа (POST /v2/orders) имеет ту же форму, что и
 * ответ на подписку вебхука: {entity: {uuid} | null, requests: [{...}]}.
 * Заводим отдельный тип (а не переиспользуем webhook-тип), чтобы не путать
 * доменные сущности в сигнатурах методов, хотя форма совпадает.
 */
export type ResponseCreateOrderCdek = {
	entity: {
		uuid: string;
	} | null;
	requests: [
		{
			request_uuid: string;
			type: string;
			date_time: string;
			state: string;
			errors: [
				{
					code: string;
					message: string;
				},
			];
		},
	];
};

/** Ответ СДЕК на редактирование заказа (PATCH /v2/orders) — форма та же, что у создания. */
export type ResponseUpdateOrderCdek = ResponseCreateOrderCdek;

/** Ответ СДЕК на регистрацию отказа (POST /v2/orders/{uuid}/refusal) — форма та же, что у создания. */
export type ResponseRefusalOrderCdek = ResponseCreateOrderCdek;
