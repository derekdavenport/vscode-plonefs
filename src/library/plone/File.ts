import * as vscode from 'vscode';
import { get, getBuffer, post } from '../util';
import { BaseFile } from '.';
import { RequestOptions } from 'https';

export default class File extends BaseFile {
	language: string;

	constructor(uri: vscode.Uri, exists = false) {
		super(uri, exists);
		this.language = 'plaintext';
	}

	load(cookie: string): Promise<boolean> {
		if (this.loading) {
			return this.loadingPromise;
		}
		this.loading = true;
		return this.loadingPromise = this._load(cookie);
	}

	private async _load(cookie: string): Promise<boolean> {
		const languagesPromise = vscode.languages.getLanguages();
		const response = await get({
			host: this.uri.authority,
			path: this.uri.path + '/at_download/file',
			headers: { cookie },
		});
		if (response.statusCode !== 200) {
			this.loading = false;
			throw vscode.FileSystemError.Unavailable(`${response.statusCode}: ${response.statusMessage}`);
		}

		const contentType = response.headers['content-type'];
		if (contentType) {
			const mimeType = contentType.split(';')[0];
			const [type, subtype] = mimeType.split('/');
			const languages = await languagesPromise;
			if (languages.indexOf(subtype) >= 0) {
				this.language = subtype;
			}
			else if (languages.indexOf(type) >= 0) {
				this.language = type;
			}
		}
		this.data = await getBuffer(response);
		this.loading = false;
		return this.loaded = true;
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
			},
		};
		const options: RequestOptions = {
			host: this.uri.authority,
			path: savePath + '/atct_edit',
			headers: { cookie },
		};
		const response = await post(options, postData);
		if (response.statusCode !== 302) {
			throw vscode.FileSystemError.Unavailable(`${response.statusCode}: ${response.statusMessage}`);
		}
		return this.exists = true;
	}
}