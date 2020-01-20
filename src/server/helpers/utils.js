/*
 * Copyright (C) 2015       Ben Ockmore
 *               2015-2017  Sean Burke
 				 2019       Akhilesh Kumar (@akhilesh26)
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with this program; if not, write to the Free Software Foundation, Inc.,
 * 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA.
 */

// @flow

import Promise from 'bluebird';
import _ from 'lodash';

/**
 * Returns an API path for interacting with the given Bookshelf entity model
 *
 * @param {object} entity - Entity object
 * @returns {string} - URL path to interact with entity
 */
export function getEntityLink(entity: Object): string {
	return `/${_.kebabCase(entity.type)}/${entity.bbid}`;
}

/**
 * Returns all entity models defined in bookbrainz-data-js
 *
 * @param {object} orm - the BookBrainz ORM, initialized during app setup
 * @returns {object} - Object mapping model name to the entity model
 */
export function getEntityModels(orm: Object): Object {
	const {Author, Edition, EditionGroup, Publisher, Work} = orm;
	return {
		Author,
		Edition,
		EditionGroup,
		Publisher,
		Work
	};
}
async function getParentAlias(orm, entityType, bbid) {
	const rawSql = `
		SELECT alias.name,
			alias.sort_name,
			alias.id,
			alias.language_id,
			alias.primary
		FROM bookbrainz.${_.snakeCase(entityType)}
		LEFT JOIN bookbrainz.alias ON alias.id = default_alias_id
		WHERE bbid = '${bbid}' AND master = FALSE
		ORDER BY revision_id DESC
		LIMIT 1;
	`;

	// Query the database to get the parent revision default alias
	const queryResult = await orm.bookshelf.knex.raw(rawSql);
	if (!Array.isArray(queryResult.rows)) {
		return null;
	}
	const rows = queryResult.rows.map((rawQueryResult) => {
		// Convert query keys to camelCase
		const queriedResult = _.mapKeys(
			rawQueryResult,
			(value, key) => _.camelCase(key)
		);
		return queriedResult;
	});
	return {
		parentAlias: rows[0]
	};
}
function getRevisionModels(orm) {
	const {AuthorRevision, EditionRevision, EditionGroupRevision, PublisherRevision, WorkRevision} = orm;
	return [
		AuthorRevision,
		EditionGroupRevision,
		EditionRevision,
		PublisherRevision,
		WorkRevision
	];
}
async function getCompleteRevision(revision, orm) {
	const {Entity, AliasSet} = orm;
	const RevisionModels = getRevisionModels(orm);
	for (let i = 0; i < RevisionModels.length; i++) {
		const Model = RevisionModels[i];
		const modelPromise = new Model({id: revision.id})
			.fetch({
				withRelated: [
					'data', 'entity'
				]
			});
		// eslint-disable-next-line no-await-in-loop
		const modelAchievement = await modelPromise;
		if (modelAchievement) {
			const bbid = modelAchievement.toJSON().bbid ? modelAchievement.toJSON().bbid : null;
			const aliasSetId = modelAchievement.toJSON().data ? modelAchievement.toJSON().data.aliasSetId : null;
			const aliasPromise = new AliasSet({id: aliasSetId})
				.fetch({
					withRelated: [
						'defaultAlias'
					]
				});
			const entityPromise = new Entity({bbid}).fetch();

			// eslint-disable-next-line no-await-in-loop
			const [alias, entity] = await Promise.all([aliasPromise, entityPromise]);

			const defaultAliasDict = alias ? alias.toJSON() : {};
			const entityDict = entity ? entity.toJSON() : {};
			// eslint-disable-next-line no-await-in-loop
			const parentAliasDict = await getParentAlias(orm, entityDict.type, entityDict.bbid);
			const revisionId = revision.id;

			revision.editor = revision.author;
			delete revision.author;

			return {
				revisionId,
				...revision,
				...defaultAliasDict,
				...entityDict,
				...parentAliasDict
			};
		}
	}
	return {};
}

export async function getOrderedRevisions(from, size, entityModels, orm) {
	const {Revision} = orm;
	const revisionPromise = new Revision().orderBy('created_at', 'DESC')
		.fetchPage({
			limit: size,
			offset: from,
			withRelated: [
				'author'
			]
		});
	const revisions = await revisionPromise;
	const orderedRevisions = [];
	for (let i = 0; i < revisions.toJSON().length; i++) {
		// eslint-disable-next-line no-await-in-loop
		const revision = await getCompleteRevision(revisions.toJSON()[i], orm);
		orderedRevisions.push(revision);
	}
	return orderedRevisions;
}

export function getDateBeforeDays(days) {
	const date = new Date();
	date.setDate(date.getDate() - days);
	return date;
}

export function filterIdentifierTypesByEntityType(
	identifierTypes: Array<Object>,
	entityType: string
): Array<Object> {
	return identifierTypes.filter(
		(type) => type.entityType === entityType
	);
}

export function filterIdentifierTypesByEntity(
	identifierTypes: Array<Object>,
	entity: Object
): Array<Object> {
	const typesOnEntity = new Set();

	if (!entity.identifierSet || entity.identifierSet.identifiers.length < 1) {
		/*
		 * If there are no identifiers, skip the work of trying to add types
		 * which shouldn't be on this entity.
		 */
		return filterIdentifierTypesByEntityType(identifierTypes, entity.type);
	}

	for (const identifier of entity.identifierSet.identifiers) {
		typesOnEntity.add(identifier.type.id);
	}

	return identifierTypes.filter(
		(type) => type.entityType === entity.type || typesOnEntity.has(type.id)
	);
}

/**
 * Retrieves the Bookshelf entity model with the given the model name
 *
 * @param {object} orm - the BookBrainz ORM, initialized during app setup
 * @param {string} type - Name or type of model
 * @throws {Error} Throws a custom error if the param 'type' does not
 * map to a model
 * @returns {object} - Bookshelf model object with the type specified in the
 * single param
 */
export function getEntityModelByType(orm: Object, type: string): Object {
	const entityModels = getEntityModels(orm);

	if (!entityModels[type]) {
		throw new Error(`Unrecognized entity type: '${type}'`);
	}

	return entityModels[type];
}

/**
 * Helper-function / template-tag that allows the values of an object that
 * is passed in at a later time to be interpolated into a
 * string.
 *
 * Cribbed from MDN documentation on template literals:
 * https://developer.mozilla.org/en/docs/Web/JavaScript/Reference/Template_literals#Tagged_template_literals
 *
 * @param {string[]} strings - Array of string literals from template
 * @returns {function(*)} - Takes an object/array as an argument.
 * When invoked, it will return a string with all the key names from
 * the tagged template literal replaced with their corresponding values
 * from the newly passed in object.
 */
export function template(strings: Array<string>): Function {
	// eslint-disable-next-line prefer-reflect, prefer-rest-params
	const keys = Array.prototype.slice.call(arguments, 1);

	return (values): string => {
		const result = [strings[0]];

		keys.forEach((key, i) => {
			result.push(values[key], strings[i + 1]);
		});

		return result.join('');
	};
}

/**
 * Generates a page title for an entity row
 *
 * @param {object} entity - Entity object
 * @param {string} titleForUnnamed - Fallback title in case entity has no name
 * @param {function} templateForNamed - Accepts an object with a name field and
 * uses it to generate a title string
 * @returns {string} - Title string
 */
export function createEntityPageTitle(
	entity: Object,
	titleForUnnamed: string,
	templateForNamed: Function
): string {
	/**
	 * User-visible strings should _never_ be created by concatenation; when we
	 * start to implement localization, it will create problems for users of
	 * many languages. This helper is here to make it a little easier to do the
	 * right thing.
	 */
	let title = titleForUnnamed;

	// Accept template with a "name" replacement field
	if (entity && entity.defaultAlias && entity.defaultAlias.name) {
		title = templateForNamed({name: entity.defaultAlias.name});
	}

	return title;
}

/**
 * Adds 1 to the edit count of the specified editor
 *
 * @param {object} orm - the BookBrainz ORM, initialized during app setup
 * @param {string} id - row ID of editor to be updated
 * @param {object} transacting - Bookshelf transaction object (must be in
 * progress)
 * @returns {Promise} - Resolves to the updated editor model
 */
export function incrementEditorEditCountById(
	orm: Object,
	id: string,
	transacting: Object
): Promise<Object> {
	const {Editor} = orm;
	return new Editor({id})
		.fetch({transacting})
		.then((editor) => {
			editor.incrementEditCount();
			return editor.save(null, {transacting});
		});
}

/**
 * Removes all rows from a selection of database tables
 *
 * @param {object} Bookshelf - Bookshelf instance connected to database
 * @param {string[]} tables - List of tables to truncate
 * @returns {Promise} a promise which will be fulfilled when the operation to
 *                    truncate tables completes
 */
export function truncateTables(Bookshelf: Object, tables: Array<string>) {
	return Promise.each(
		tables, (table) => Bookshelf.knex.raw(`TRUNCATE ${table} CASCADE`)
	);
}

/**
 * Return additional relations to withRelated array according to modelType
 *
 * @param {string} modelType - type of the model or entity
 * @returns {array} array of additional relations
 */
export function getAdditionalRelations(modelType) {
	if (modelType === 'Work') {
		return ['disambiguation', 'workType'];
	}
	else if (modelType === 'Edition') {
		return ['disambiguation', 'releaseEventSet.releaseEvents', 'identifierSet.identifiers.type', 'editionFormat'];
	}
	return [];
}
