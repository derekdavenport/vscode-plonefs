'use strict';
import * as vscode from 'vscode';

// import PloneFS, { CookieStore } from '../PloneFS';
jest.mock('../PloneFS', jest.fn());
// (PloneFS as jest.Mock<PloneFS>).mockImplementation(() => ({
	

// 		login: jest.fn()
// 	}
// }));

jest.mock('fs');
jest.mock('path');

describe('ploneFS', () => {

	test('blah', () => {
		// const uri = vscode.Uri.parse('plone://example.com'),
		// 	cookie = 'cookie';
		// const cookieStore: CookieStore = {};
		// cookieStore[uri.authority + uri.path] = cookie;
		//const ploneFS = new PloneFS(cookieStore);
		//const mockLogin = jest.spyOn(ploneFS, 'login');
		//mockLogin.mockImplementation(() => "cookie");
		//ploneFS.stat(uri);
	});
});