'use strict';
import * as http from 'http';
import * as https from 'https';
import * as querystring from 'querystring';
import * as mime from 'mime/lite';

type FileType = {
	filename: string,
	data: Uint8Array,
	contentType?: string
};

type ValueType = string | { toString(): string };

type FormData = {
	[name: string]: ValueType;
};

export type MultipartData = {
	[name: string]: ValueType | FileType;
};

function isFileType(value: ValueType | FileType): value is FileType {
	return typeof (value as FileType).filename === 'string' && typeof (value as FileType).data === 'object';
}

function isValueType(value: ValueType | FileType): value is ValueType {
	return typeof value === 'string' || typeof value.toString === 'function';
}

function isFormData(data: MultipartData): data is FormData {
	return Object.values(data).every(value => isValueType(value));
}

export async function post(options: https.RequestOptions, formData: FormData): Promise<http.IncomingMessage>;
export async function post(options: https.RequestOptions, formData: MultipartData): Promise<http.IncomingMessage> {
	if (isFormData(formData)) {
		return postFormData(options, formData);
	}
	else {
		return postMultipartData(options, formData);
	}
}

async function postFormData(options: https.RequestOptions, formData: FormData) {
	return new Promise<http.IncomingMessage>((resolve, reject) => {
		const formDataBuffer = Buffer.from(querystring.stringify(formData));
		options = {
			...options,
			method: 'POST',
			headers: {
				...options.headers,
				'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
				'Content-Length': formDataBuffer.length,
			},
		};
		const request = https.request(options, response => {
			resolve(response);
		});
		request.on('error', error => {
			reject(error);
		});
		request.end(formDataBuffer);
	});
}

async function postMultipartData(options: https.RequestOptions, multipartData: MultipartData) {
	return new Promise<http.IncomingMessage>((resolve, reject)=> {
		const lineEnd = '\r\n';
		const twoHyphens = '--';
		const boundary = '*****' + Date.now().toString(36);
		options = {
			...options,
			method: 'POST',
			headers: {
				...options.headers,
				'Content-Type': 'multipart/form-data; charset=utf-8; boundary=' + boundary,
				// TODO: add "Content-Length": ??? plone doesn't require it, but other sites might if reuse this code
			}
		};
		const request = https.request(options, response => {
			resolve(response);
		});
		request.on('error', error => {
			reject(error);
		});
		for (const name in multipartData) {
			const value = multipartData[name];
			request.write(twoHyphens + boundary + lineEnd);
			if (isFileType(value)) {
				const filename = value.filename;
				const contentType = value.contentType || mime.getType(filename) || 'text/plain';
				request.write(`Content-Disposition: form-data; name="${name}"; filename="${filename}"`);
				request.write(lineEnd);
				request.write(`Content-Type: ${contentType}`);
				request.write(lineEnd + lineEnd);
				request.write(value.data);
			}
			else {
				request.write(`Content-Disposition: form-data; name="${name}"`);
				request.write(lineEnd + lineEnd);
				request.write(value.toString());
			}
			request.write(lineEnd);
		}
		request.end(twoHyphens + boundary + twoHyphens + lineEnd);
	});
}