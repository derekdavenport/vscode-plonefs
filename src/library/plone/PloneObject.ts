'use strict';
import * as vscode from 'vscode';
import * as path from 'path';
import * as https from 'https';
import * as querystring from 'querystring';

export default abstract class PloneObject implements vscode.FileStat {
	type: vscode.FileType;
	ctime: number;
	mtime: number;
	size: number;

	private _uri: vscode.Uri;
	get uri() {
		return this._uri;
	}
	set uri(uri: vscode.Uri) {
		this._uri = uri;
		this._path = path.posix.parse(uri.path);
	}
	private _path: path.ParsedPath;
	get path() {
		return this._path;
	}
	name: string;

	loading: boolean;
	loaded: boolean;
	loadingPromise: Promise<boolean>;
	abstract load(string?): Promise<boolean>;

	exists: boolean;

	constructor(uri: vscode.Uri, exists = false) {
		this.ctime = this.mtime = Date.now();
		this.size = 0;
		this.uri = uri;
		this.name = this.path.base;

		this.loading = false;
		this.loaded = false;

		this.exists = exists;
	}

	async getNewSavePath(cookie: string) {
		return new Promise<string>((resolve, reject) => {
			const options = {
				host: this.uri.authority,
				path: PloneObject.escapePath(this.path.dir) + '/createObject?type_name=' + this.constructor.name,
				headers: {
					"Cookie": cookie,
				},
			};
			https.get(options, response => {
				if (response.statusCode === 302) {
					const location = response.headers['location'];
					if (location) {
						const locationPath = path.posix.parse(location);
						if (locationPath.base.startsWith('edit')) {
							resolve(locationPath.dir);
						}
						else {
							reject('bad location');
						}
					}
					else {
						reject('no location');
					}
				}
				else {
					reject(response.statusMessage);
				}
			});
		});
	}

	async save(cookie: string) {
		// if doesn't exist, create
		const savePath = this.exists ? this.uri.path : await this.getNewSavePath(cookie);
		return new Promise<boolean>((resolve, reject) => {
			const postData = Buffer.from(querystring.stringify({
				id: this.name,
				title: this.name,
				'form.submitted': 1,
			}));
			const options = {
				method: 'post',
				host: this.uri.authority,
				path: PloneObject.escapePath(savePath) + '/atct_edit',
				headers: {
					"Cookie": cookie,
					"Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
					"Content-Length": postData.length,
				},
			};
			const request = https.request(options, response => {
				if (response.statusCode === 302) {
					// in case of rename
					this.uri = this.uri.with({ path: this.path.dir + '/' + this.name });
					resolve(this.exists = true);
				}
				else {
					return reject(`${response.statusCode}: ${response.statusMessage}`);
				}
			});
			request.on('error', error => {
				throw error;
			});
			request.end(postData);
		});
	}

	protected static escapePath(path: string): string {
		return path.replace(/([\u0000-\u0020])/g, $1 => '%' + $1.charCodeAt(0).toString(16));
	}
}