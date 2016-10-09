"use strict";

var path = require('path'),
	loki = require('lokijs'),
	Promise = require('bluebird'),
	fs = Promise.promisifyAll(require('fs-extra')),
	multer  = require('multer'),
	_ = require('lodash');

var regFolderName = new RegExp("^[a-z0-9][a-z0-9\-]*[a-z0-9]$");

/**
 * Local Data Storage
 *
 * @param      {Object}  appconfig  The application configuration
 */
module.exports = {

	_uploadsPath: './repo/uploads',
	_uploadsThumbsPath: './data/thumbs',
	_uploadsFolders: [],
	_uploadsDb: null,

	uploadImgHandler: null,

	/**
	 * Initialize Local Data Storage model
	 *
	 * @param      {Object}  appconfig  The application config
	 * @return     {Object}  Local Data Storage model instance
	 */
	init(appconfig, mode = 'server') {

		let self = this;

		self._uploadsPath = path.resolve(ROOTPATH, appconfig.datadir.repo, 'uploads');
		self._uploadsThumbsPath = path.resolve(ROOTPATH, appconfig.datadir.db, 'thumbs');

		// Finish initialization tasks

		switch(mode) {
			case 'agent':
				//todo
			break;
			case 'server':
				self.createBaseDirectories(appconfig);
				self.initMulter(appconfig);
			break;
			case 'ws':
				self.initDb(appconfig);
			break;
		}

		return self;

	},

	/**
	 * Initialize Uploads DB
	 *
	 * @param      {Object}   appconfig  The application config
	 * @return     {boolean}  Void
	 */
	initDb(appconfig) {

		let self = this;

		let dbReadyResolve;
		let dbReady = new Promise((resolve, reject) => {
			dbReadyResolve = resolve;
		});

		// Initialize Loki.js

		let dbModel = {
			Store: new loki(path.join(appconfig.datadir.db, 'uploads.db'), {
				env: 'NODEJS',
				autosave: true,
				autosaveInterval: 15000
			}),
			onReady: dbReady
		};

		// Load Models

		dbModel.Store.loadDatabase({}, () => {

			dbModel.Files = dbModel.Store.getCollection('Files');
			if(!dbModel.Files) {
				dbModel.Files = dbModel.Store.addCollection('Files', {
					indices: ['category', 'folder']
				});
			}

			dbReadyResolve();

		});

		self._uploadsDb = dbModel;

		return true;

	},

	/**
	 * Init Multer upload handlers
	 *
	 * @param      {Object}   appconfig  The application config
	 * @return     {boolean}  Void
	 */
	initMulter(appconfig) {

		this.uploadImgHandler = multer({
			storage: multer.diskStorage({
				destination: (req, f, cb) => {
					cb(null, path.resolve(ROOTPATH, appconfig.datadir.db, 'temp-upload'))
				}
			}),
			fileFilter: (req, f, cb) => {

				//-> Check filesize (3 MB max)

				if(f.size > 3145728) {
					return cb(null, false);
				}

				//-> Check MIME type (quick check only)

				if(!_.includes(['image/png', 'image/jpeg', 'image/gif', 'image/webp'], f.mimetype)) {
					return cb(null, false);
				}

				cb(null, true);
			}
		}).array('imgfile', 20);

		return true;

	},

	/**
	 * Gets the thumbnails folder path.
	 *
	 * @return     {String}  The thumbs path.
	 */
	getThumbsPath() {
		return this._uploadsThumbsPath;
	},

	/**
	 * Creates a base directories (Synchronous).
	 *
	 * @param      {Object}  appconfig  The application config
	 * @return     {Void}  Void
	 */
	createBaseDirectories(appconfig) {

		winston.info('[SERVER] Checking data directories...');

		try {
			fs.ensureDirSync(path.resolve(ROOTPATH, appconfig.datadir.db));
			fs.ensureDirSync(path.resolve(ROOTPATH, appconfig.datadir.db, './cache'));
			fs.ensureDirSync(path.resolve(ROOTPATH, appconfig.datadir.db, './thumbs'));
			fs.ensureDirSync(path.resolve(ROOTPATH, appconfig.datadir.db, './temp-upload'));

			fs.ensureDirSync(path.resolve(ROOTPATH, appconfig.datadir.repo));
			fs.ensureDirSync(path.resolve(ROOTPATH, appconfig.datadir.repo, './uploads'));
		} catch (err) {
			winston.error(err);
		}

		winston.info('[SERVER] Data and Repository directories are OK.');

		return;

	},

	/**
	 * Sets the uploads folders.
	 *
	 * @param      {Array<String>}  arrFolders  The arr folders
	 * @return     {Void}  Void
	 */
	setUploadsFolders(arrFolders) {

		this._uploadsFolders = arrFolders;
		return;

	},

	/**
	 * Gets the uploads folders.
	 *
	 * @return     {Array<String>}  The uploads folders.
	 */
	getUploadsFolders() {
		return this._uploadsFolders;
	},

	/**
	 * Creates an uploads folder.
	 *
	 * @param      {String}  folderName  The folder name
	 * @return     {Promise}  Promise of the operation
	 */
	createUploadsFolder(folderName) {

		let self = this;

		folderName = _.kebabCase(_.trim(folderName));

		if(_.isEmpty(folderName) || !regFolderName.test(folderName)) {
			return Promise.resolve(self.getUploadsFolders());
		}

		return fs.ensureDirAsync(path.join(self._uploadsPath, folderName)).then(() => {
			if(!_.includes(self._uploadsFolders, folderName)) {
				self._uploadsFolders.push(folderName);
				self._uploadsFolders = _.sortBy(self._uploadsFolders);
			}
			return self.getUploadsFolders();
		});

	},

	/**
	 * Check if folder is valid and exists
	 *
	 * @param      {String}  folderName  The folder name
	 * @return     {Boolean}   True if valid
	 */
	validateUploadsFolder(folderName) {

		folderName = (_.includes(this._uploadsFolders, folderName)) ? folderName : '';
		return path.resolve(this._uploadsPath, folderName);

	},

	/**
	 * Check if filename is valid and unique
	 *
	 * @param      {String}           f       The filename
	 * @param      {String}           fld     The containing folder
	 * @return     {Promise<String>}  Promise of the accepted filename
	 */
	validateUploadsFilename(f, fld) {

		let fObj = path.parse(f);
		let fname = _.chain(fObj.name).trim().toLower().kebabCase().value().replace(/[^a-z0-9\-]+/g, '');
		let fext = _.toLower(fObj.ext);

		if(!_.includes(['.jpg', '.jpeg', '.png', '.gif', '.webp'], fext)) {
			fext = '.png';
		}

		f = fname + fext;
		let fpath = path.resolve(this._uploadsPath, fld, f);

		return fs.statAsync(fpath).then((s) => {
			throw new Error('File ' + f + ' already exists.');
		}).catch((err) => {
			if(err.code === 'ENOENT') {
				return f;
			}
			throw err;
		});

	},

	/**
	 * Parse relative Uploads path
	 *
	 * @param      {String}  f       Relative Uploads path
	 * @return     {Object}  Parsed path (folder and filename)
	 */
	parseUploadsRelPath(f) {

		let fObj = path.parse(f);
		return {
			folder: fObj.dir,
			filename: fObj.base
		};

	},

	/**
	 * Sets the uploads files.
	 *
	 * @param      {Array<Object>}  arrFiles  The uploads files
	 * @return     {Void}  Void
	 */
	setUploadsFiles(arrFiles) {

		let self = this;

		if(_.isArray(arrFiles) && arrFiles.length > 0) {
			self._uploadsDb.Files.clear();
			self._uploadsDb.Files.insert(arrFiles);
			self._uploadsDb.Files.ensureIndex('category', true);
			self._uploadsDb.Files.ensureIndex('folder', true);
		}

		return;

	},

	/**
	 * Adds one or more uploads files.
	 *
	 * @param      {Array<Object>}  arrFiles  The uploads files
	 * @return     {Void}  Void
	 */
	addUploadsFiles(arrFiles) {
		if(_.isArray(arrFiles) || _.isPlainObject(arrFiles)) {
			this._uploadsDb.Files.insert(arrFiles);
		}
		return;
	},

	/**
	 * Gets the uploads files.
	 *
	 * @param      {String}  cat     Category type
	 * @param      {String}  fld     Folder
	 * @return     {Array<Object>}  The files matching the query
	 */
	getUploadsFiles(cat, fld) {

		return this._uploadsDb.Files.chain().find({
			'$and': [{ 'category' : cat	},{ 'folder' : fld }]
		}).simplesort('filename').data();

	}

};