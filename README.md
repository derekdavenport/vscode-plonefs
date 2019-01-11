# PloneFS

Open site by issuing command "PloneFS: Open Plone Workspace"

Move and Delete currently unsupported.

## Use

### Open a Plone Site (Add Plone site to Workspace)

* Press F1 to open the Command Pallet
* Search for  and click "Plone File System: Add Plone site to Workspace"
* A dropdown will appear with a list of previously used sites and "new"
* Click on a site to open or "new" to open a new site
* If a new site, an input box will appear for the address, enter the address of your site home
* Enter username (if a previous login has not expired, this and the next step will be skipped)
* Enter password
* The site will be added to Visual Studio Code's Explorer

### Editing Title/Description (and Local CSS if installed)

* Right-click an entry in Visual Studio Code Explorer
* Select "More Plone Options"
* A drop down will appear with options you can edit
* If selected, Local CSS wil open as a document

## TODO

* edit site root Title/Description
* change State
* login again after cookie expires
* edit static text portlets
* delete
* add source control https://code.visualstudio.com/docs/extensionAPI/api-scm