import PloneObject from './PloneObject';
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

export { PloneObject, BaseFolder, Folder, BaseFile, Document, Page, NewsItem, Event, Topic, File, LocalCss, PortletManager, Portlet };
export type Entry = BaseFolder | Folder | PortletManager | BaseFile | Document | Page | NewsItem | Event | Topic | File | LocalCss | Portlet;

export enum StateText {
	internal = 'Internal draft',
	external = 'Externally visible',
	internally_published = 'Internally published',
	internally_restricted = 'Internally restricted',
	private = 'Private',
	pending = 'Pending review',
};

export enum TextState {
	'Internal draft' = 'internal',
	'Externally visible' = 'external',
	'Internally published' = 'internally_published',
	'Internally restricted' = 'internally_restricted',
	'Private' = 'private',
	'Pending review' = 'pending',
};

export type State = keyof typeof StateText;

export interface WithState extends PloneObject {
	state: State;
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
	// [side in PortletSideType]: PortletManager<side>;
	top: PortletManager<'top'>,
	right: PortletManager<'right'>,
	bottom: PortletManager<'bottom'>,
	left: PortletManager<'left'>,
}

export interface WithPortlets extends PloneObject {
	portletManagers: PortletManagers;
}

export function isWithPortlets(ploneObject: PloneObject): ploneObject is WithPortlets {
	return typeof (ploneObject as WithPortlets).portletManagers === 'object'; // && ploneObject.portlets.each()
}

