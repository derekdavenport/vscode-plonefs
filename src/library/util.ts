'use strict';
import * as http from 'http';
import * as https from 'https';
import * as querystring from 'querystring';
import * as mime from 'mime/lite';

/**
 * helper function to use promise instead of setting a callback
 * @param options Request Options
 */
export function get(options: https.RequestOptions) {
	return new Promise<http.IncomingMessage>((resolve, reject) => {
		const request = https.get(options);
		request.on('response', response => resolve(response));
		request.on('error', error => reject(error));
	});
}
export function getBuffer(response: http.IncomingMessage) {
	return new Promise<Buffer>((resolve, reject) => {
		let buffers: Buffer[] = [];
		response.on('data', (chunk: Buffer) => buffers.push(chunk));
		response.on('end', () => resolve(Buffer.concat(buffers)));
		response.on('error', error => reject(error));
	});
}

type FileType = {
	filename: string,
	data: Uint8Array,
	contentType?: string
};

type ValueType = string | number | boolean;

// TODO: this is wrong because forms don't have unique keys
// need to accept and handle arrays
export type FormData = {
	[name: string]: ValueType | ValueType[];
};

export type MultipartData = {
	[name: string]: FileType | FileType[] | ValueType | ValueType[];
};

function isFileType(value: any): value is FileType {
	return value instanceof Object && typeof (value as FileType).filename === 'string' && typeof (value as FileType).data === 'object';
}

function isValueType(value: any): value is ValueType {
	return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

// function isFileTypeArray(value: any): value is FileType[] {
// 	return value instanceof Array && value.every(v => isFileType(v));
// }

function isValueTypeArray(value: any): value is ValueType[] {
	return value instanceof Array && value.every(v => isValueType(v));
}

function isFormData(data: FormData | MultipartData): data is FormData {
	return Object.values(data).every(value => isValueType(value) || isValueTypeArray(value));
}

// function isMultipartData(data: FormData | MultipartData): data is MultipartData {
// 	// this won't work because I can't force some to be filetype
// 	return Object.values(data).some(value => isFileType(value));
// }

// export async function post(options: https.RequestOptions, formData: FormData): Promise<http.IncomingMessage>;
// export async function post(options: https.RequestOptions, formData: MultipartData): Promise<http.IncomingMessage>;
export function post(options: https.RequestOptions, formData: FormData | MultipartData): Promise<http.IncomingMessage> {
	if (isFormData(formData)) {
		return postFormData(options, formData);
	}
	else {
		return postMultipartData(options, formData);
	}
}

function postFormData(options: https.RequestOptions, formData: FormData) {
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
		const request = https.request(options);
		request.on('response', response => resolve(response));
		request.on('error', error => reject(error));
		request.end(formDataBuffer);
	});
}

function postMultipartData(options: https.RequestOptions, multipartData: MultipartData) {
	return new Promise<http.IncomingMessage>((resolve, reject) => {
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
		const request = https.request(options);
		request.on('response', response => resolve(response));
		request.on('error', error => reject(error));
		function writeValue(name: string, value: ValueType) {
			request.write(twoHyphens + boundary + lineEnd);
			request.write(`Content-Disposition: form-data; name="${name}"`);
			request.write(lineEnd + lineEnd);
			request.write(value.toString());
			request.write(lineEnd);
		}
		function writeFile(name: string, file: FileType) {
			const filename = file.filename;
			const contentType = file.contentType || mime.getType(filename) || 'text/plain';
			request.write(twoHyphens + boundary + lineEnd);
			request.write(`Content-Disposition: form-data; name="${name}"; filename="${filename}"`);
			request.write(lineEnd);
			request.write(`Content-Type: ${contentType}`);
			request.write(lineEnd + lineEnd);
			request.write(file.data);
			request.write(lineEnd);
		}
		for (const name in multipartData) {
			const data = multipartData[name];
			if (isValueType(data)) {
				writeValue(name, data);
			}
			else if (isFileType(data)) {
				writeFile(name, data);
			}
			else if (isValueTypeArray(data)) {
				data.forEach(value => writeValue(name, value));
			}
			else {
				data.forEach(file => writeFile(name, file));
			}
		}
		request.end(twoHyphens + boundary + twoHyphens + lineEnd);
	});
}

/**
 * escape all illegal characters in path part of URL for node http/https packages
 * @param uriPath path to be escapped for node http/https packages
 */
export function escapePath(uriPath: string): string {
	return uriPath.replace(/[\u0000-\u0020]/g, $1 => '%' + $1.charCodeAt(0).toString(16));
}