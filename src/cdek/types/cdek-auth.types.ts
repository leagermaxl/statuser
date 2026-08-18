export type ResponseAuthCdekOk = {
	access_token: string;
	token_type: string;
	expires_in: number;
	scope: string;
	jti: string;
};

export type ResponseAuthCdekBad = {
	error: string;
	error_description: string;
};

export type ResponseAuthCdek = ResponseAuthCdekOk | ResponseAuthCdekBad;
