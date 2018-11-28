'use strict';
import * as vscode from 'vscode';

import PloneFS, { CredentialStore } from '../PloneFS';
jest.mock('../PloneFS', jest.fn());
// (PloneFS as jest.Mock<PloneFS>).mockImplementation(() => ({
	

// 		login: jest.fn()
// 	}
// }));

jest.mock('fs');
jest.mock('path');

describe('ploneFS', () => {

	test('blah', () => {
		const uri = vscode.Uri.parse('plone://example.com/test'), username = 'username', password = 'password';
		const credentialStore: CredentialStore = {};
		credentialStore[uri.authority + uri.path] = { username, password };
		const ploneFS = new PloneFS(credentialStore);
		const mockLogin = jest.spyOn(ploneFS, 'login');
		mockLogin.mockImplementation(() => "cookie");
		ploneFS.stat(uri)
	});
});