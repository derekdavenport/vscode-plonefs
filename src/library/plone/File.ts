import * as vscode from 'vscode';
import * as http from 'http';
import * as https from 'https';
import PloneObject from './PloneObject';
import * as mime from 'mime/lite';

export default class File extends PloneObject {
	data: Uint8Array;
	language: string;

	constructor(uri: vscode.Uri, exists = false) {
		super(uri, exists);
		this.type = vscode.FileType.File;
		this.language = 'plaintext';
	}

	async load(cookie: string): Promise<boolean> {
		if (this.loading) {
			return this.loadingPromise;
		}
		this.loading = true;
		const languages = await vscode.languages.getLanguages();
		return this.loadingPromise = new Promise<boolean>((resolve, reject) => {
			const request = https.get({
				host: this.uri.authority,
				path: File.escapePath(this.uri.path) + '/at_download/file',
				headers: {
					Cookie: cookie,
				}
			}, response => {
				if (response.statusCode === 200) {
					const contentType = response.headers['content-type'];
					if (contentType) {
						const mimeType = contentType.split(';')[0];
						const [type, subtype] = mimeType.split('/');
						if (languages.indexOf(subtype) >= 0) {
							this.language = subtype;
						}
						else if (languages.indexOf(type) >= 0) {
							this.language = type;
						}
					}
					let buffers: Buffer[] = [];
					response.on('data', (chunk: Buffer) => buffers.push(chunk));
					response.on('end', () => {
						this.data = Buffer.concat(buffers);
						this.loading = false;
						resolve(this.loaded = true);
					});
				}
				else {
					this.loading = false;
					reject(`${response.statusCode}: ${response.statusMessage}`);
				}
			});
			request.end();
		});
	}

	async save(cookie: string) {
		let savePath = this.uri.path;
		if (!this.exists) {
			//return await this.create(cookie);
			// plone does not allow empty files
			this.data = Buffer.from('\n');
			savePath = await this.getNewSavePath(cookie);
		}
		// Plone cannot update with empty data
		if (!this.data.length) {
			return false;
		}
		const postData = {
			id: this.name,
			title: this.name,
			'form.submitted': '1',
			file_file: {
				filename: this.name,
				data: this.data,
			}
		};
		const options = {
			host: this.uri.authority,
			path: savePath + '/atct_edit',
			headers: {
				"Cookie": cookie,
			},
		};
		const response = await this.post(options, postData);
		if (response.statusCode === 302) {
			return this.exists = true;
		}
		else {
			throw new Error(`${response.statusCode}: ${response.statusMessage}`);
		}
	}

	async create(cookie: string) {
		const options = {
			host: this.uri.authority,
			path: this.path.dir + '/tinymce-upload',
			headers: {
				"Cookie": cookie,
			},
		};
		const contentType = mime.getType(this.name) || 'text/plain';
		const postData = {
			uploadfile: {
				filename: this.name,
				data: Buffer.from(contentType), //this.data,
				contentType, // if the type is text/* plone will create a page, not a file
			},
			uploadtitle: this.name,
			uploaddescription: '',
		};
		const response = await this.post(options, postData);
		if (response.statusCode === 200) {
			return this.exists = true;
		}
		else {
			throw new Error(`${response.statusCode}: ${response.statusMessage}`);
		}
	}

	private async post(options: http.RequestOptions, postData: { [name: string]: string | { filename: string, data: Uint8Array, contentType?: string } }) {
		return new Promise<http.IncomingMessage>(resolve => {
			const lineEnd = '\r\n';
			const twoHyphens = '--';
			const boundary = '*****' + Date.now().toString(36);
			options = {
				...options,
				method: 'POST',
				headers: {
					...options.headers,
					'Content-Type': 'multipart/form-data; charset=utf-8; boundary=' + boundary,
					// "Content-Length": ???
				}
			};
			const request = https.request(options, response => {
				resolve(response);
			});
			for (const name in postData) {
				const value = postData[name];
				request.write(twoHyphens + boundary + lineEnd);
				if (typeof value === 'string') {
					request.write(`Content-Disposition: form-data; name="${name}"`);
					request.write(lineEnd + lineEnd);
					request.write(value.toString());
				}
				else {
					const filename = value.filename;
					const contentType = value.contentType || mime.getType(filename) || 'text/plain';
					request.write(`Content-Disposition: form-data; name="${name}"; filename="${filename}"`);
					request.write(lineEnd);
					request.write(`Content-Type: ${contentType}`);
					request.write(lineEnd + lineEnd);
					request.write(value.data);
				}
				request.write(lineEnd);
			}
			request.end(twoHyphens + boundary + twoHyphens + lineEnd);
		});
	}
}