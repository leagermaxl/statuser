export type ResponseWebhookInfoCdek = {
	uuid: string;
	type: string;
	url: string;
};

export type ResponseWebhookSubscriptionCdek = {
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
