# Plone File System (PloneFS)

Open Plone sites in Visual Studio Code

## Use

### Open a Plone Site (Add Plone site to Workspace)

* Press F1 (Mac Command + Shift + P) to open the Command Pallet
* Select "Plone File System: Add Plone site to Workspace" (search for "Plone")
* A dropdown will appear with a list of previously used sites and "new"
* Click on a site to open or "new" to open a new site
* If a new site, an input box will appear for the address, enter the address of your site home
* Enter username (if a previous login has not expired, this and the next step will be skipped)
* Enter password
* The site will be added to Visual Studio Code's Explorer

### Editing Title / Description / State (and Local CSS if installed)

* Right-click an entry in Visual Studio Code Explorer
* Select "Plone Options"
* A drop down will appear with options you can edit
* If selected, Local CSS wil open as a document

Note: Files do not have State. The Title and State are also displayed on the status bar for the current active document and can be edited by clicking on them.

### Creating a Text Portlet

* Right-click a File or Folder in Visual Studio Code Explorer
* Select "Plone Options"
* Select "Portlets"
* Select a side
* Select "+ new"
* Enter a Header for the Portlet
* You will be taken back to the Portlets list with your new Portlet added

### Editing a Text Portlet

* Right-click a File or Folder in Visual Studio Code Explorer
* Select "Plone Options"
* Select "Portlets"
* Select a side
* Select the Text Portlet you want to edit (non Text Portlets are shown, but selecting one will give an error)

### Creating Working Copies

* Right-click a Document in Visual Studio Code Explorer
* Select "Plone Options"
* If the Document is not a Working Copy, there will be an option for "Check Out"
* Select "Check Out"
* The Working Copy starting with the name "copy_of_" will appear in the current folder

Note: Folders, Files, and Collections cannot be checked out.

### Checking in Working Copies

* Right-click a Working Copy in Visual Studio Code Explorer
* Select "Plone Options"
* If the Document is a Working Copy, there will be options for "Check In" and "Cancel Check Out"
* If you select "Check In" you will need to supply a check in message and press Enter / Return

## Missing features

* Cannot create new Event, News Item, or Collection
* Portlet header changes not saved until portlet saved
* no "Exclude from Navigation" setting
* checking in a working copy causes the original document if opened to be marked dirty (unsaved)
* cannot edit site root folder Title / Description
* cannot delete
* no support for edit history ([source control](https://code.visualstudio.com/docs/extensionAPI/api-scm))