/*
 * Copyright (C) 2015  Ben Ockmore
 *               2015  Sean Burke
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

const React = require('react');
const Icon = require('react-fontawesome');

const Aliases = require('./parts/aliases.jsx');
const RevisionNote = require('./parts/revisionNote.jsx');
const PublicationData = require('./parts/publicationData.jsx');
const LoadingSpinner = require('../loading_spinner.jsx');

const request = require('superagent');
require('superagent-bluebird-promise');

const Nav = require('react-bootstrap').Nav;
const NavItem = require('react-bootstrap').NavItem;

module.exports = React.createClass({
	displayName: 'publicationForm',
	propTypes: {
		identifierTypes: React.PropTypes.array,
		languages: React.PropTypes.array,
		publication: React.PropTypes.object,
		publicationTypes: React.PropTypes.array,
		submissionUrl: React.PropTypes.string
	},
	getInitialState() {
		'use strict';

		return {
			tab: 1,
			aliasesValid: true,
			dataValid: true,
			waiting: false
		};
	},
	setTab(tab) {
		'use strict';

		this.setState({
			tab,
			aliasesValid: this.refs.aliases.valid(),
			dataValid: this.refs.data.valid()
		});
	},
	backClick() {
		'use strict';

		this.setTab(this.state.tab - 1);
	},
	nextClick() {
		'use strict';

		this.setTab(this.state.tab + 1);
	},
	handleSubmit(evt) {
		'use strict';

		evt.preventDefault();

		if (!(this.state.aliasesValid && this.state.dataValid)) {
			return;
		}

		const aliasData = this.refs.aliases.getValue();
		const publicationData = this.refs.data.getValue();
		const revisionNote = this.refs.revision.refs.note.getValue();
		const data = {
			aliases: aliasData,
			publicationTypeId: parseInt(publicationData.publicationType, 10),
			disambiguation: publicationData.disambiguation,
			annotation: publicationData.annotation,
			identifiers: publicationData.identifiers,
			note: revisionNote
		};

		this.setState({waiting: true});

		request.post(this.props.submissionUrl)
			.send(data).promise()
			.then((revision) => {
				if (!revision.body || !revision.body.entity) {
					window.location.replace('/login');
					return;
				}
				window.location.href =
					`/publication/${revision.body.entity.entity_gid}`;
			})
			.catch((error) => {
				this.setState({error});
			});
	},
	render() {
		'use strict';

		let aliases = null;
		const prefillData = this.props.publication;
		if (prefillData) {
			aliases = prefillData.aliasSet.aliases.map((alias) => ({
				id: alias.id,
				name: alias.name,
				sortName: alias.sortName,
				language: alias.language ? alias.language.id : null,
				primary: alias.primary,
				default: alias.id === prefillData.defaultAlias.id
			}));
		}

		const submitEnabled = this.state.aliasesValid && this.state.dataValid;

		const loadingElement = this.state.waiting ? <LoadingSpinner/> : null;

		const invalidIcon = (
			<span>&nbsp;
				<Icon
					className="text-danger"
					name="warning"
				/>
			</span>
		);

		return (
			<div>
				{loadingElement}

				<Nav
					activeKey={this.state.tab}
					bsStyle="tabs"
					onSelect={this.setTab}
				>
					<NavItem eventKey={1}>
						<strong>1.</strong> Aliases
						{this.state.aliasesValid || invalidIcon}
					</NavItem>
					<NavItem eventKey={2}>
						<strong>2.</strong> Data
						{this.state.dataValid || invalidIcon}
					</NavItem>
					<NavItem eventKey={3}>
						<strong>3.</strong> Revision Note
					</NavItem>
				</Nav>


				<form onChange={this.handleChange}>
					<Aliases
						aliases={aliases}
						languages={this.props.languages}
						nextClick={this.nextClick}
						ref="aliases"
						visible={this.state.tab === 1}
					/>
					<PublicationData
						backClick={this.backClick}
						identifierTypes={this.props.identifierTypes}
						nextClick={this.nextClick}
						publication={this.props.publication}
						publicationTypes={this.props.publicationTypes}
						ref="data"
						visible={this.state.tab === 2}
					/>
					<RevisionNote
						backClick={this.backClick}
						ref="revision"
						submitDisabled={!submitEnabled}
						visible={this.state.tab === 3}
						onSubmit={this.handleSubmit}
					/>
				</form>
			</div>
		);
	}
});
