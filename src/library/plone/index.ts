import PloneObject, { PloneObjectOptions } from './PloneObject';
import BaseFolder from './BaseFolder';
import Folder from './Folder';
import BaseFile from './BaseFile';
import Document from './Document';
import Page from './Page';
import NewsItem from './NewsItem';
import Event from './Event';
import Topic from './Topic';
import File from './File';
import LocalCss from './LocalCss';
import Portlet from './Portlet';
import PortletManager from './PortletManager';

export { PloneObject, PloneObjectOptions, BaseFolder, Folder, BaseFile, Document, Page, NewsItem, Event, Topic, File, LocalCss, PortletManager, Portlet };
export type Entry = BaseFolder | BaseFile | Folder | PortletManager | Document | Page | NewsItem | Event | Topic | File | LocalCss | Portlet;

export enum StateText {
	internal = 'Internal draft',
	external = 'Externally visible',
	internally_published = 'Internally published',
	internally_restricted = 'Internally restricted',
	private = 'Private',
	pending = 'Pending review',
};
export type State = keyof typeof StateText;

export enum ActionState {
	show_internally = 'internal',
	hide = 'internal',
	publish_externally = 'external',
	publish_internally = 'internally_published',
	publish_restricted = 'internally_restricted',
	submit = 'pending',
	retract = 'internal',
};
export type StateAction = keyof typeof ActionState;

export const stateActions: {
	[state in State]: {
		[text: string]: StateAction;
	};
} = {
	internal: {
		'Make private': 'hide',
		'Publish externally': 'publish_externally',
		'Publish internally': 'publish_internally',
		'Publish restricted': 'publish_restricted',
		'Submit for publication': 'submit',
	},
	private: {
		'Publish externally': 'publish_externally',
		'Publish internally': 'publish_internally',
		'Show internally': 'show_internally',
	},
	external: {
		'Retract': 'retract',
	},
	internally_published: {
		'Publish externally': 'publish_externally',
		'Retract': 'retract',
	},
	internally_restricted: {
		'Retract': 'retract',
	},
	pending: {
		'Publish externally': 'publish_externally',
		'Publish internally': 'publish_internally',
		'Publish restricted': 'publish_restricted',
		'Retract': 'retract',
	},
};

export interface WithState extends PloneObject {
	state: State;
	changeState(stateAction: StateAction): Promise<void>;
}

export function isWithState(ploneObject: PloneObject): ploneObject is WithState {
	return Object.keys(StateText).includes((ploneObject as WithState).state);
}

export interface WithLocalCss extends PloneObject {
	hasLocalCss: boolean;
	localCss: LocalCss | undefined;
}

export function isWithLocalCss(ploneObject: PloneObject): ploneObject is WithLocalCss {
	return typeof (ploneObject as WithLocalCss).hasLocalCss === 'boolean';
}
export enum PortletSides {
	top = 'top',
	right = 'right',
	bottom = 'bottom',
	left = 'left',
}
export type PortletSideType = keyof typeof PortletSides;

export enum PortletUrls {
	'++contextportlets++uofl.heromanager' = 'top',
	'++contextportlets++plone.rightcolumn' = 'right',
	'++contextportlets++uofl.prefootermanager' = 'bottom',
	'++contextportlets++plone.leftcolumn' = 'left',
}

export enum PortletSideUrls {
	top = '++contextportlets++uofl.heromanager',
	right = '++contextportlets++plone.rightcolumn',
	bottom = '++contextportlets++uofl.prefootermanager',
	left = '++contextportlets++plone.leftcolumn',
}

export enum PortletManagerSides {
	top = 'uofl-heromanager',
	right = 'plone-rightcolumn',
	bottom = 'uofl-prefootermanager',
	left = 'plone-leftcolumn',
}

export type PortletManagers = {
	[S in PortletSideType]: PortletManager<S>;
}

export interface WithPortlets extends PloneObject {
	portletManagers: PortletManagers;
}

export function isWithPortlets(ploneObject: PloneObject): ploneObject is WithPortlets {
	return typeof (ploneObject as WithPortlets).portletManagers === 'object'; // && ploneObject.portlets.each()
}

