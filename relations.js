// The relations of a person are kept on the person as relations = { parents, siblings, partners, children, blockedInferences }, each of the four is a list of entries, an entry is { personId, variants, preferredVariantIndex } for someone who has a page, or { text, variants, preferredVariantIndex } for someone only written down as plain text, the variants are the sources that disagree or agree, each is { subtype, links, note, isAutoInferred, inferenceId, derivedFrom, isQuestioned }, a variant is either typed in by the user or worked out by the page from the parents that were entered, which is isAutoInferred, a typed variant that the page worked out the same kind of link for carries that as hasInference, inferenceId, derivedFrom and inferenceNote instead of getting a second variant next to it, blockedInferences is optional and is a list of role:targetId texts for links that the user removed after the page worked them out, the page does not work those out again until that person is added by hand under that role, and a person with no relations at all has no such property
let relationRoles = [`parents`, `siblings`, `partners`, `children`]
let relationRoleLabels = {
	parents : `Parents`,
	siblings : `Siblings`,
	partners : `Partners`,
	children : `Children`
}
let relationRoleSingularLabels = {
	parents : `parent`,
	siblings : `sibling`,
	partners : `partner`,
	children : `child`
}

// Which kinds of link each role can have, a half sibling only exists between siblings, and a partner link is married, partner or separated, which is a pair who were together
let relationSubtypes = {
	parents : [`biological`, `step`, `non-biological`, `unknown`],
	siblings : [`biological`, `half`, `step`, `non-biological`, `unknown`],
	partners : [`married`, `partner`, `separated`, `unknown`],
	children : [`biological`, `step`, `non-biological`, `unknown`]
}
let relationSubtypeLabels = {
	biological : `Biological`,
	half : `Half`,
	step : `Step`,
	[`non-biological`] : `Non-biological`,
	married : `Married`,
	partner : `Partner`,
	separated : `Separated`,
	unknown : `Unknown`
}

// Plain text relatives found by their normalised name, so one click can offer to link every written down copy of the same name to a new page, it is rebuilt whenever the people are loaded or the relations change
let plainTextRelationIndex = {}

// The dialog works on copies of all three lists, so Cancel throws every change away, entries is the copy of every role, and the selection is the entry and the source of the side on show, addedKeys are the role:personId texts of the people who were added by hand in the dialog, so saving can let the page work those out again
let relationsDraft = {
	personId : null,
	role : `parents`,
	entries : {
		parents : [],
		siblings : [],
		children : []
	},
	selectedEntryIndex : 0,
	selectedVariantIndex : 0,
	addedKeys : new Set()
}

function getBlankRelationVariant() {
	return {
		subtype : `unknown`,
		links : [],
		note : null,
		isAutoInferred : false,
		inferenceId : null,
		derivedFrom : null,
		isQuestioned : false
	}
}

// The property is only created when there is something to put in it, and every list is there once it exists
function ensureRelations(person) {
	if(!person.relations){
		person.relations = {
			parents : [],
			siblings : [],
			partners : [],
			children : []
		}
	}

	for(let role of relationRoles){
		if(!Array.isArray(person.relations[role])){
			person.relations[role] = []
		}
	}

	return person.relations
}

// A person whose lists are all empty has no relations property, the same as a person who never had any, unless links are still kept from being worked out, an empty list of those is dropped
function cleanupRelations(person) {
	if(!person.relations){
		return
	}

	if(Array.isArray(person.relations.blockedInferences) && person.relations.blockedInferences.length == 0){
		delete person.relations.blockedInferences
	}

	if(!person.relations.blockedInferences && relationRoles.every((role) => (person.relations[role] ?? []).length == 0)){
		delete person.relations
	}
}

function getReciprocalRole(role) {
	if(role == `parents`){
		return `children`
	}

	if(role == `children`){
		return `parents`
	}

	return role
}

// A link the user took away after the page worked it out is written as role:targetId, which is the role on the list of the person and the person who was on it
function buildBlockedInferenceKey(role, targetId) {
	return `${role}:${targetId}`
}

function isInferenceBlocked(person, role, targetId) {
	return (person.relations?.blockedInferences ?? []).includes(buildBlockedInferenceKey(role, targetId))
}

// From now on the page does not work out this link for this person, the key is only written once
function blockInference(person, role, targetId) {
	let relations = ensureRelations(person)
	let key = buildBlockedInferenceKey(role, targetId)

	if(!Array.isArray(relations.blockedInferences)){
		relations.blockedInferences = []
	}

	if(!relations.blockedInferences.includes(key)){
		relations.blockedInferences.push(key)
	}
}

// A link that is added by hand again is worked out normally again, so its key is taken out, and the list goes when nothing is left in it
function unblockInference(person, role, targetId) {
	let blockedInferences = person.relations?.blockedInferences

	if(!Array.isArray(blockedInferences)){
		return
	}

	person.relations.blockedInferences = blockedInferences.filter((key) => key != buildBlockedInferenceKey(role, targetId))

	if(person.relations.blockedInferences.length == 0){
		delete person.relations.blockedInferences
	}
}

function findRelationEntry(person, role, personId) {
	return person.relations?.[role]?.find((entry) => entry.personId === personId)
}

// The role under which a person is linked to another, whichever it is, or null when they are not linked
function getLinkedRole(person, personId) {
	return relationRoles.find((role) => findRelationEntry(person, role, personId)) ?? null
}

// The source that the page shows for an entry, which is the starred one
function getPreferredRelationVariant(entry) {
	return entry.variants[entry.preferredVariantIndex] ?? entry.variants[0] ?? null
}

function getManualVariants(entry) {
	return entry.variants.filter((variant) => !variant.isAutoInferred)
}

// The sources that the page worked out and that still hold, on their own or carried by a typed source, one that was flagged as questioned is not counted because it was going to go anyway
function getUnquestionedInferences(entry) {
	return entry.variants.filter((variant) => (variant.isAutoInferred || variant.hasInference === true) && !variant.isQuestioned)
}

// What the page worked out belongs to the list it was worked out for, so a copy of a typed source for someone else, or for a name written as plain text, is made without it
function copyVariantWithoutInference(variant) {
	let copy = { ...variant, links : [...(variant.links ?? [])] }

	delete copy.hasInference
	delete copy.inferenceNote

	copy.inferenceId = null
	copy.derivedFrom = null
	copy.isQuestioned = false

	return copy
}

// A typed source and a source that the page worked out on its own for the same kind of link are one source, so the standalone inferred one is taken off the entry and, when it still held, what it worked out goes onto the typed source, the star moves to the typed source when it was on the one that went, this is for an entry whose typed sources may have just been added or changed to a kind of link that the page had already worked out
function absorbDuplicateInferences(entry) {
	let preferredVariant = entry.variants[entry.preferredVariantIndex]
	let keptVariants = []

	for(let variant of entry.variants){
		let carrier = variant.isAutoInferred ? entry.variants.find((otherVariant) => !otherVariant.isAutoInferred && otherVariant.subtype === variant.subtype) : null

		if(!carrier){
			keptVariants.push(variant)

			continue
		}

		if(!variant.isQuestioned && carrier.hasInference !== true){
			carrier.hasInference = true
			carrier.inferenceId = variant.inferenceId
			carrier.derivedFrom = variant.derivedFrom
			carrier.inferenceNote = variant.note
			carrier.isQuestioned = false
		}
	}

	if(keptVariants.length == entry.variants.length){
		return
	}

	entry.variants = keptVariants
	entry.preferredVariantIndex = Math.max(keptVariants.includes(preferredVariant) ? keptVariants.indexOf(preferredVariant) : keptVariants.findIndex((variant) => !variant.isAutoInferred && variant.subtype === preferredVariant?.subtype), 0)
}

// The second line of a source in the relations dialog, the note first, then what the page worked out when a typed source carries it, then the links
function buildRelationVariantExtraHtml(variant) {
	return buildVariantExtraHtml({
		...variant,
		note : [variant.note, variant.hasInference === true ? variant.inferenceNote : null].filter((part) => part).join(` \u00b7 `) || null
	})
}

function getRelationEntryLabel(entry) {
	if(entry.isNew){
		return getPendingPersonName(entry)
	}

	return entry.personId == null ? entry.text : getNameLabel(persons[entry.personId])
}

// Only the sources typed in by the user are mirrored, the parents of a person are their parents and that person is a child of theirs, a sibling is a sibling both ways, the sources inferred by the page are worked out on each side on their own and are never copied, the star follows the same source when it is a typed one and otherwise stays where it was on the other side, a person who gets an entry on the other side for the first time is added by hand there, so the page may work that link out again
function syncReciprocalRelation(ownerId, role, targetId) {
	let owner = persons[ownerId]
	let target = persons[targetId]

	if(!owner || !target){
		return
	}

	let ownerEntry = findRelationEntry(owner, role, targetId)
	let manualVariants = ownerEntry ? getManualVariants(ownerEntry) : []

	if(manualVariants.length == 0){
		removeReciprocalRelation(ownerId, role, targetId)

		return
	}

	let reciprocalRole = getReciprocalRole(role)
	let otherRole = getLinkedRole(target, ownerId)

	// A person that is already linked to the other under a different role is left as it is, so one person is never linked twice
	if(otherRole && otherRole != reciprocalRole){
		return
	}

	let targetEntry = findRelationEntry(target, reciprocalRole, ownerId)

	if(!targetEntry){
		unblockInference(target, reciprocalRole, ownerId)

		targetEntry = {
			personId : ownerId,
			variants : [],
			preferredVariantIndex : 0
		}

		ensureRelations(target)[reciprocalRole].push(targetEntry)
	}

	let copies = manualVariants.map((variant) => {
		let copy = copyVariantWithoutInference(variant)

		delete copy.hasConflict

		return copy
	})
	let autoVariants = targetEntry.variants.filter((variant) => variant.isAutoInferred)
	let oldPreferredVariant = targetEntry.variants[targetEntry.preferredVariantIndex]
	let manualPreferredIndex = manualVariants.indexOf(ownerEntry.variants[ownerEntry.preferredVariantIndex])

	targetEntry.variants = [...copies, ...autoVariants]
	targetEntry.preferredVariantIndex = manualPreferredIndex != -1 ? manualPreferredIndex : Math.max(targetEntry.variants.indexOf(oldPreferredVariant), 0)
}

// Takes the typed sources of the owner out of the other side, an entry that is left with nothing is removed, and one that still has inferred sources stays with those
function removeReciprocalRelation(ownerId, role, targetId) {
	let target = persons[targetId]

	if(!target){
		return
	}

	let reciprocalRole = getReciprocalRole(role)
	let targetEntry = findRelationEntry(target, reciprocalRole, ownerId)

	if(!targetEntry){
		return
	}

	let oldPreferredVariant = targetEntry.variants[targetEntry.preferredVariantIndex]

	targetEntry.variants = targetEntry.variants.filter((variant) => variant.isAutoInferred)

	if(targetEntry.variants.length == 0){
		target.relations[reciprocalRole] = target.relations[reciprocalRole].filter((entry) => entry !== targetEntry)
	} else {
		targetEntry.preferredVariantIndex = Math.max(targetEntry.variants.indexOf(oldPreferredVariant), 0)
	}

	cleanupRelations(target)
}

// What a person written into a file by hand or by an older version may hold is made safe, entries of people that no longer exist are dropped, a person is only linked once under one role, every source gets all its parts, a single link of an older version becomes a list of links, and a subtype that the role does not have becomes unknown
function sanitizeRelationVariant(role, variant) {
	let blankVariant = getBlankRelationVariant()

	return {
		subtype : relationSubtypes[role].includes(variant.subtype) ? variant.subtype : `unknown`,
		links : sanitizeLinks(variant),
		note : typeof variant.note == `string` && variant.note != `` ? variant.note : null,
		isAutoInferred : variant.isAutoInferred === true,
		inferenceId : typeof variant.inferenceId == `string` ? variant.inferenceId : blankVariant.inferenceId,
		derivedFrom : Array.isArray(variant.derivedFrom) ? variant.derivedFrom.filter((key) => typeof key == `string`) : blankVariant.derivedFrom,
		isQuestioned : variant.isQuestioned === true,
		...(variant.isAutoInferred !== true && variant.hasInference === true ? { hasInference : true, inferenceNote : typeof variant.inferenceNote == `string` ? variant.inferenceNote : null } : {}),
		...(variant.hasConflict === true ? { hasConflict : true } : {})
	}
}

function sanitizeRelations(person) {
	if(!isPlainObject(person.relations)){
		delete person.relations

		return
	}

	let cleanedRelations = {
		parents : [],
		siblings : [],
		partners : [],
		children : []
	}
	let linkedPersonIds = new Set()

	for(let role of relationRoles){
		for(let entry of Array.isArray(person.relations[role]) ? person.relations[role] : []){
			if(!isPlainObject(entry)){
				continue
			}

			let personId = Number(entry.personId)
			let hasPerson = entry.personId != null && Number.isInteger(personId) && persons[personId] && persons[personId] !== person
			let hasText = typeof entry.text == `string` && entry.text.trim() != ``

			if(!hasPerson && !hasText){
				continue
			}

			if(hasPerson && linkedPersonIds.has(personId)){
				continue
			}

			let variants = (Array.isArray(entry.variants) ? entry.variants : [])
				.filter(isPlainObject)
				.map((variant) => sanitizeRelationVariant(role, variant))

			if(variants.length == 0){
				variants.push(getBlankRelationVariant())
			}

			let preferredVariantIndex = Number.isInteger(entry.preferredVariantIndex) && variants[entry.preferredVariantIndex] ? entry.preferredVariantIndex : 0

			if(hasPerson){
				linkedPersonIds.add(personId)
			}

			cleanedRelations[role].push(hasPerson ? {
				personId : personId,
				variants : variants,
				preferredVariantIndex : preferredVariantIndex
			} : {
				text : entry.text.trim(),
				variants : variants,
				preferredVariantIndex : preferredVariantIndex
			})
		}
	}

	// The links kept from being worked out are only role:personId texts of people who still exist and who are not the person themselves, each once
	let blockedInferences = [...new Set(Array.isArray(person.relations.blockedInferences) ? person.relations.blockedInferences : [])].filter((key) => {
		if(typeof key != `string` || !/^(parents|siblings|partners|children):\d+$/.test(key)){
			return false
		}

		let blockedPerson = persons[Number(key.split(`:`)[1])]

		return Boolean(blockedPerson) && blockedPerson !== person
	})

	if(blockedInferences.length > 0){
		cleanedRelations.blockedInferences = blockedInferences
	}

	person.relations = cleanedRelations

	cleanupRelations(person)
}

// A link used in a derivation is written as role:ownerId:targetId:subtype, which is the entry on the list of the owner that has the target in that role, with the kind of link it had when it was used
function buildDerivationKey(role, ownerId, targetId, subtype) {
	return `${role}:${ownerId}:${targetId}:${subtype}`
}

function parseDerivationKey(key) {
	let [role, ownerText, targetText, subtype] = `${key}`.split(`:`)
	let ownerId = Number(ownerText)
	let targetId = Number(targetText)

	if(!relationRoles.includes(role) || !Number.isInteger(ownerId) || !Number.isInteger(targetId) || !subtype){
		return null
	}

	return {
		role : role,
		ownerId : ownerId,
		targetId : targetId,
		subtype : subtype
	}
}

// A link is active when it is the starred source of its entry, with that kind of link, and has not been questioned, a link that a person typed in is active as it is, a link that the page worked out is only active when everything it was worked out from is still active, and a link that is found again while checking itself is not active, so two links that were only ever worked out from each other cannot keep each other alive once what they came from is gone
function isDerivationKeyActive(key, visitedKeys) {
	let parsedKey = parseDerivationKey(key)

	if(!parsedKey || visitedKeys.has(key) || !persons[parsedKey.ownerId]){
		return false
	}

	let entry = findRelationEntry(persons[parsedKey.ownerId], parsedKey.role, parsedKey.targetId)
	let variant = entry ? getPreferredRelationVariant(entry) : null

	if(!variant || variant.subtype != parsedKey.subtype || variant.isQuestioned){
		return false
	}

	if(!variant.isAutoInferred){
		return true
	}

	return isDerivationActive(variant.derivedFrom, new Set([...visitedKeys, key]))
}

// Every link in the list has to be active, the keys can be about parents or about siblings, or about children
function isDerivationActive(derivedFrom, visitedKeys = new Set()) {
	return Array.isArray(derivedFrom) && derivedFrom.every((key) => isDerivationKeyActive(key, visitedKeys))
}

function isActiveLink(role, ownerId, targetId, subtype) {
	return isDerivationKeyActive(buildDerivationKey(role, ownerId, targetId, subtype), new Set())
}

// Everyone who has a page that is an active biological link in a role of a person
function getActiveBiologicalIds(role, ownerId) {
	return (persons[ownerId]?.relations?.[role] ?? [])
		.filter((entry) => entry.personId != null && isActiveLink(role, ownerId, entry.personId, `biological`))
		.map((entry) => entry.personId)
}

// The parents that count for working out siblings are the ones in the starred source of each parent entry that has a page and is active, a parent whose starred source is unknown does not count, the result is a map from the id of the parent to the subtype
function getActiveRelationParents(personId) {
	let activeParents = new Map()

	for(let entry of persons[personId]?.relations?.parents ?? []){
		let variant = getPreferredRelationVariant(entry)

		if(entry.personId == null || entry.personId === personId || !persons[entry.personId] || !variant || variant.subtype == `unknown` || !isActiveLink(`parents`, personId, entry.personId, variant.subtype)){
			continue
		}

		activeParents.set(entry.personId, variant.subtype)
	}

	return activeParents
}

// The parents of everyone are worked out for a whole pass, and from them who the children of each parent are, the context is built again whenever something changed, because a parent that was worked out from a sibling is a parent that the next step can use
function buildInferenceContext() {
	let parentMaps = new Map()
	let childrenByParent = new Map()

	for(let id of Object.keys(persons)){
		let personId = Number(id)
		let parentMap = getActiveRelationParents(personId)

		parentMaps.set(personId, parentMap)

		for(let parentId of parentMap.keys()){
			if(!childrenByParent.has(parentId)){
				childrenByParent.set(parentId, new Set())
			}

			childrenByParent.get(parentId).add(personId)
		}
	}

	return {
		parentMaps : parentMaps,
		childrenByParent : childrenByParent
	}
}

// Each of two children having another biological parent of their own, and those being different people, is what makes a shared parent a half sibling link, all four places for a biological parent are then taken and only one of them is the same, the gender of the parents does not matter, a child who has no other biological parent recorded leaves it open whether the two share that parent as well, so the link stays unknown
function areOtherParentsDistinct(firstParentIds, secondParentIds) {
	return firstParentIds.some((firstParentId) => secondParentIds.some((secondParentId) => firstParentId != secondParentId))
}

// A parent that was worked out from the sibling link between the person and the other one says nothing about that same link, so it is not counted as a shared parent for those two
function isParentDerivedFromPair(personId, parentId, otherId) {
	let entry = findRelationEntry(persons[personId], `parents`, parentId)
	let variant = entry ? getPreferredRelationVariant(entry) : null

	if(!variant?.isAutoInferred){
		return false
	}

	return (variant.derivedFrom ?? []).some((key) => {
		let parsedKey = parseDerivationKey(key)

		return parsedKey?.role == `siblings` && ((parsedKey.ownerId == personId && parsedKey.targetId == otherId) || (parsedKey.ownerId == otherId && parsedKey.targetId == personId))
	})
}

// Two people who share two biological parents are full siblings, who share only one are half siblings when each of them has another biological parent of their own and those are different people, and are unknown otherwise, and who share no biological parent but share a parent that is a step or non-biological parent for one of them are step siblings
function getExpectedSibling(firstId, secondId, context) {
	let firstParents = context.parentMaps.get(firstId)
	let secondParents = context.parentMaps.get(secondId)
	let sharedIds = [...firstParents.keys()].filter((parentId) => secondParents.has(parentId) && !isParentDerivedFromPair(firstId, parentId, secondId) && !isParentDerivedFromPair(secondId, parentId, firstId))

	if(sharedIds.length == 0){
		return null
	}

	let sharedBiologicalIds = sharedIds.filter((parentId) => firstParents.get(parentId) == `biological` && secondParents.get(parentId) == `biological`)
	let subtype = `step`

	if(sharedBiologicalIds.length >= 2){
		subtype = `biological`
	} else if(sharedBiologicalIds.length == 1){
		let firstOtherIds = [...firstParents].filter(([parentId, parentSubtype]) => parentSubtype == `biological` && parentId != sharedBiologicalIds[0]).map(([parentId]) => parentId)
		let secondOtherIds = [...secondParents].filter(([parentId, parentSubtype]) => parentSubtype == `biological` && parentId != sharedBiologicalIds[0]).map(([parentId]) => parentId)

		subtype = areOtherParentsDistinct(firstOtherIds, secondOtherIds) ? `half` : `unknown`
	}

	let namedParentId = sharedBiologicalIds[0] ?? sharedIds[0]

	return {
		subtype : subtype,
		inferenceId : `siblings:${firstId}:${secondId}:${subtype}`,
		derivedFrom : sharedIds.flatMap((parentId) => [buildDerivationKey(`parents`, firstId, parentId, firstParents.get(parentId)), buildDerivationKey(`parents`, secondId, parentId, secondParents.get(parentId))]),
		note : `Shared parent: ${getNameLabel(persons[namedParentId])} (computationally inferred \u2014 verify manually)`
	}
}

// What the page wants on one list is a map from the target to the kinds of link wanted for them, one for each kind, the first one found for a kind is the one kept
function addWantedLink(wantedLinks, targetId, wantedLink) {
	if(!wantedLinks.has(targetId)){
		wantedLinks.set(targetId, new Map())
	}

	if(!wantedLinks.get(targetId).has(wantedLink.subtype)){
		wantedLinks.get(targetId).set(wantedLink.subtype, wantedLink)
	}
}

// Who the page wants on the sibling list of a person, first the people who share an active parent with them, then rule A, if two people are both active biological siblings of a third, they are biological siblings of each other
function getDesiredSiblings(personId, context) {
	let wantedLinks = new Map()

	for(let parentId of context.parentMaps.get(personId)?.keys() ?? []){
		for(let candidateId of context.childrenByParent.get(parentId) ?? []){
			if(candidateId == personId || wantedLinks.has(candidateId)){
				continue
			}

			let expectedSibling = getExpectedSibling(personId, candidateId, context)

			if(expectedSibling){
				addWantedLink(wantedLinks, candidateId, expectedSibling)
			}
		}
	}

	for(let entry of persons[personId]?.relations?.siblings ?? []){
		let middleId = entry.personId

		if(middleId == null || !isActiveLink(`siblings`, middleId, personId, `biological`)){
			continue
		}

		for(let otherId of getActiveBiologicalIds(`siblings`, middleId)){
			if(otherId == personId){
				continue
			}

			addWantedLink(wantedLinks, otherId, {
				subtype : `biological`,
				inferenceId : `siblings:${personId}:${otherId}:biological`,
				derivedFrom : [buildDerivationKey(`siblings`, middleId, personId, `biological`), buildDerivationKey(`siblings`, middleId, otherId, `biological`)],
				note : `Both are biological siblings of ${getNameLabel(persons[middleId])} (computationally inferred \u2014 verify manually)`
			})
		}
	}

	return wantedLinks
}

// Rule B, if a person is an active biological sibling of another, who has an active biological parent, that parent is an active biological parent of the person as well
function getDesiredParents(personId) {
	let wantedLinks = new Map()

	for(let entry of persons[personId]?.relations?.siblings ?? []){
		let middleId = entry.personId

		if(middleId == null || !isActiveLink(`siblings`, middleId, personId, `biological`)){
			continue
		}

		for(let parentId of getActiveBiologicalIds(`parents`, middleId)){
			if(parentId == personId){
				continue
			}

			addWantedLink(wantedLinks, parentId, {
				subtype : `biological`,
				inferenceId : `parents:${personId}:${parentId}:biological`,
				derivedFrom : [buildDerivationKey(`siblings`, middleId, personId, `biological`), buildDerivationKey(`parents`, middleId, parentId, `biological`)],
				note : `Biological parent of biological sibling ${getNameLabel(persons[middleId])} (computationally inferred \u2014 verify manually)`
			})
		}
	}

	// Rule D, the partner of an active biological parent of a person is a step parent of that person, a pair who are married or partners count, a pair who have separated or whose kind is not known do not, and neither does a partner who already has an active biological or non-biological link with the person
	for(let birthParentId of getActiveBiologicalIds(`parents`, personId)){
		for(let partnerEntry of persons[birthParentId]?.relations?.partners ?? []){
			let partnerId = partnerEntry.personId

			if(partnerId == null || partnerId == personId || !persons[partnerId] || hasActiveParentalLink(partnerId, personId)){
				continue
			}

			let partnerSubtype = getActivePartnerSubtype(partnerId, birthParentId)

			if(!partnerSubtype){
				continue
			}

			addWantedLink(wantedLinks, partnerId, {
				subtype : `step`,
				inferenceId : `parents:${personId}:${partnerId}:step`,
				derivedFrom : [buildDerivationKey(`partners`, partnerId, birthParentId, partnerSubtype), buildDerivationKey(`parents`, personId, birthParentId, `biological`)],
				note : `Partner of biological parent ${getNameLabel(persons[birthParentId])} (computationally inferred \u2014 verify manually)`
			})
		}
	}

	return wantedLinks
}

// The other side of rule B, a parent has as a child everyone who is an active biological sibling of one of their active biological children
function getDesiredChildren(personId) {
	let wantedLinks = new Map()

	for(let entry of persons[personId]?.relations?.children ?? []){
		let middleId = entry.personId

		if(middleId == null || !isActiveLink(`parents`, middleId, personId, `biological`)){
			continue
		}

		for(let siblingId of getActiveBiologicalIds(`siblings`, middleId)){
			if(siblingId == personId){
				continue
			}

			addWantedLink(wantedLinks, siblingId, {
				subtype : `biological`,
				inferenceId : `children:${personId}:${siblingId}:biological`,
				derivedFrom : [buildDerivationKey(`siblings`, middleId, siblingId, `biological`), buildDerivationKey(`parents`, middleId, personId, `biological`)],
				note : `Biological parent of biological sibling ${getNameLabel(persons[middleId])} (computationally inferred \u2014 verify manually)`
			})
		}
	}

	// The other side of rule D, the active biological children of an active partner are step children of the person, with the same exceptions
	for(let partnerEntry of persons[personId]?.relations?.partners ?? []){
		let partnerId = partnerEntry.personId
		let partnerSubtype = partnerId == null ? null : getActivePartnerSubtype(personId, partnerId)

		if(!partnerSubtype){
			continue
		}

		for(let childEntry of persons[partnerId]?.relations?.children ?? []){
			let childId = childEntry.personId

			if(childId == null || childId == personId || !persons[childId] || !isActiveLink(`parents`, childId, partnerId, `biological`) || hasActiveParentalLink(personId, childId)){
				continue
			}

			addWantedLink(wantedLinks, childId, {
				subtype : `step`,
				inferenceId : `children:${personId}:${childId}:step`,
				derivedFrom : [buildDerivationKey(`partners`, personId, partnerId, partnerSubtype), buildDerivationKey(`parents`, childId, partnerId, `biological`)],
				note : `Partner of biological parent ${getNameLabel(persons[partnerId])} (computationally inferred \u2014 verify manually)`
			})
		}
	}

	return wantedLinks
}

// Rule C, two different people who are both active biological parents of the same child are partners, the kind of link is not known because nothing says whether they are married, the link is the same from both sides because the rule is the same for both
function getDesiredPartners(personId, context) {
	let wantedLinks = new Map()

	for(let childId of context.childrenByParent.get(personId) ?? []){
		if(context.parentMaps.get(childId)?.get(personId) != `biological`){
			continue
		}

		for(let [otherParentId, otherSubtype] of context.parentMaps.get(childId)){
			if(otherParentId == personId || otherSubtype != `biological`){
				continue
			}

			addWantedLink(wantedLinks, otherParentId, {
				subtype : `unknown`,
				inferenceId : `partners:${personId}:${otherParentId}:unknown`,
				derivedFrom : [buildDerivationKey(`parents`, childId, personId, `biological`), buildDerivationKey(`parents`, childId, otherParentId, `biological`)],
				note : `Co-parent of ${getNameLabel(persons[childId])} (computationally inferred \u2014 verify manually)`
			})
		}
	}

	return wantedLinks
}

// Whether a person already has an active biological or non-biological link with a child, from either side, such a person is a parent in their own right and is never worked out to be a step parent
function hasActiveParentalLink(parentId, childId) {
	return [`biological`, `non-biological`].some((subtype) => isActiveLink(`parents`, childId, parentId, subtype) || isActiveLink(`children`, parentId, childId, subtype))
}

// The kind of an active partner link of a person that makes the partner count for step families, which is married or partner, a link that has separated or whose kind is not known gives null, and so does a link that is not active
function getActivePartnerSubtype(ownerId, partnerId) {
	let entry = persons[ownerId] ? findRelationEntry(persons[ownerId], `partners`, partnerId) : null
	let variant = entry ? getPreferredRelationVariant(entry) : null

	if(!variant || ![`married`, `partner`].includes(variant.subtype) || !isActiveLink(`partners`, ownerId, partnerId, variant.subtype)){
		return null
	}

	return variant.subtype
}

// The kinds of link wanted for one person, a definitive kind, which is biological, half, step or non-biological, wins over unknown, so an unknown one is never wanted next to a definitive one, and a person with nothing wanted gets an empty map
function getDefinitiveWantedLinks(wantedBySubtype) {
	let wantedLinks = new Map(wantedBySubtype ?? [])

	if([...wantedLinks.keys()].some((subtype) => subtype != `unknown`)){
		wantedLinks.delete(`unknown`)
	}

	return wantedLinks
}

// Brings the inferred sources on one list of a person in line with what the page wants, a source that is still wanted is kept and updated, a source that is not wanted any more is removed when it is not the starred one and flagged as questioned when it is, so the user decides what happens to a source they chose, a source that is wanted and missing is added, an entry for a person who is already linked under another role is not made, a typed source that disagrees with every kind of link wanted for that person is flagged as a conflict, a typed source with the same kind of link as one that is wanted carries what was worked out instead of getting a second source next to it, any standalone inferred source of that kind is dropped, and the typed source loses what it carried when it no longer holds, a person whose link the user removed is not wanted at all, so the inferred sources they still have are taken away and none are added, and the answer is whether anything changed
function reconcileRoleList(person, role, wantedLinks) {
	let hasChanged = false

	wantedLinks = new Map([...wantedLinks].filter(([targetId]) => !isInferenceBlocked(person, role, targetId)))

	for(let entry of [...(person.relations?.[role] ?? [])]){
		if(entry.personId == null){
			continue
		}

		let isBlocked = isInferenceBlocked(person, role, entry.personId)
		let manualCarriers = new Map()

		for(let variant of entry.variants){
			if(!variant.isAutoInferred && !manualCarriers.has(variant.subtype)){
				manualCarriers.set(variant.subtype, variant)
			}
		}

		let wantedBySubtype = getDefinitiveWantedLinks(wantedLinks.get(entry.personId))
		let hasManualDefinitive = role == `partners` && entry.variants.some((variant) => !variant.isAutoInferred && variant.subtype != `unknown`)

		if(hasManualDefinitive){
			wantedBySubtype.delete(`unknown`)
		}

		let knownWantedSubtypes = [...wantedBySubtype.keys()].filter((subtype) => subtype != `unknown`)
		let hasDefinitiveWanted = knownWantedSubtypes.length > 0
		let preferredVariant = entry.variants[entry.preferredVariantIndex]
		let keptVariants = []
		let matchedSubtypes = new Set()

		for(let variant of entry.variants){
			if(!variant.isAutoInferred){
				let isConflicting = variant.subtype != `unknown` && knownWantedSubtypes.length > 0 && !knownWantedSubtypes.includes(variant.subtype)

				if(isConflicting != Boolean(variant.hasConflict)){
					hasChanged = true

					if(isConflicting){
						variant.hasConflict = true
					} else {
						delete variant.hasConflict
					}
				}

				let wantedForVariant = wantedBySubtype.get(variant.subtype)

				if(wantedForVariant && manualCarriers.get(variant.subtype) === variant){
					if(variant.hasInference !== true || variant.isQuestioned || variant.inferenceId != wantedForVariant.inferenceId || variant.inferenceNote != wantedForVariant.note || JSON.stringify(variant.derivedFrom) != JSON.stringify(wantedForVariant.derivedFrom)){
						hasChanged = true

						variant.hasInference = true
						variant.inferenceId = wantedForVariant.inferenceId
						variant.derivedFrom = wantedForVariant.derivedFrom
						variant.inferenceNote = wantedForVariant.note
						variant.isQuestioned = false
					}

					matchedSubtypes.add(variant.subtype)
				} else if(variant.hasInference === true || variant.inferenceNote != null || variant.inferenceId != null || variant.derivedFrom != null || variant.isQuestioned === true){
					hasChanged = true

					delete variant.hasInference
					delete variant.inferenceId
					delete variant.derivedFrom
					delete variant.inferenceNote
					delete variant.isQuestioned
				}

				keptVariants.push(variant)

				continue
			}

			if(isBlocked){
				hasChanged = true

				continue
			}

			if(hasManualDefinitive && variant.subtype == `unknown`){
				hasChanged = true

				continue
			}

			if(manualCarriers.has(variant.subtype) && wantedBySubtype.has(variant.subtype)){
				hasChanged = true

				continue
			}

			if(variant.subtype == `unknown` && hasDefinitiveWanted){
				hasChanged = true

				continue
			}

			let wanted = wantedBySubtype.get(variant.subtype)

			if(wanted && !matchedSubtypes.has(variant.subtype)){
				if(variant.isQuestioned || variant.inferenceId != wanted.inferenceId || variant.note != wanted.note || JSON.stringify(variant.derivedFrom) != JSON.stringify(wanted.derivedFrom)){
					hasChanged = true

					variant.isQuestioned = false
					variant.inferenceId = wanted.inferenceId
					variant.note = wanted.note
					variant.derivedFrom = wanted.derivedFrom
				}

				matchedSubtypes.add(variant.subtype)
				keptVariants.push(variant)

				continue
			}

			if(variant === preferredVariant){
				if(!variant.isQuestioned){
					hasChanged = true

					variant.isQuestioned = true
				}

				keptVariants.push(variant)
			} else {
				hasChanged = true
			}
		}

		for(let [subtype, wanted] of wantedBySubtype){
			if(matchedSubtypes.has(subtype)){
				continue
			}

			hasChanged = true

			keptVariants.push({
				subtype : subtype,
				links : [],
				note : wanted.note,
				isAutoInferred : true,
				inferenceId : wanted.inferenceId,
				derivedFrom : wanted.derivedFrom,
				isQuestioned : false
			})
		}

		entry.variants = keptVariants
		if(keptVariants.includes(preferredVariant)){
			entry.preferredVariantIndex = keptVariants.indexOf(preferredVariant)
		} else if(preferredVariant?.isAutoInferred && manualCarriers.has(preferredVariant.subtype) && keptVariants.includes(manualCarriers.get(preferredVariant.subtype))){
			entry.preferredVariantIndex = keptVariants.indexOf(manualCarriers.get(preferredVariant.subtype))
		} else {
			entry.preferredVariantIndex = Math.max(keptVariants.findIndex((variant) => variant.isAutoInferred && variant.subtype != `unknown`), 0)
		}

		if(keptVariants.length == 0){
			person.relations[role] = person.relations[role].filter((listEntry) => listEntry !== entry)
		}
	}

	for(let [targetId, allWantedBySubtype] of wantedLinks){
		let wantedBySubtype = getDefinitiveWantedLinks(allWantedBySubtype)

		if(!persons[targetId] || getLinkedRole(person, targetId)){
			continue
		}

		hasChanged = true

		ensureRelations(person)[role].push({
			personId : targetId,
			variants : [...wantedBySubtype.values()].map((wanted) => ({
				subtype : wanted.subtype,
				links : [],
				note : wanted.note,
				isAutoInferred : true,
				inferenceId : wanted.inferenceId,
				derivedFrom : wanted.derivedFrom,
				isQuestioned : false
			})),
			preferredVariantIndex : 0
		})
	}

	return hasChanged
}

// All three lists of a person are brought in line with their parents and their siblings, the parents and the children are only ever worked out from biological siblings
function reconcileRelations(personId, context) {
	let person = persons[personId]

	if(!person){
		return false
	}

	let wantedByRole = {
		parents : getDesiredParents(personId),
		siblings : getDesiredSiblings(personId, context),
		partners : getDesiredPartners(personId, context),
		children : getDesiredChildren(personId)
	}
	let hasChanged = false

	for(let role of relationRoles){
		if(reconcileRoleList(person, role, wantedByRole[role])){
			hasChanged = true
		}
	}

	cleanupRelations(person)

	return hasChanged
}

// Whoever can be affected when the relations of a person change, everyone they are linked to, the people they share a parent with, and for each of their siblings that sibling's own siblings and parents, because rule A reaches the siblings of siblings and rule B reaches the parents of siblings
function getRelationNeighbours(personId, context) {
	let neighbourIds = new Set()

	for(let role of relationRoles){
		for(let entry of persons[personId]?.relations?.[role] ?? []){
			if(entry.personId != null){
				neighbourIds.add(entry.personId)
			}
		}
	}

	for(let parentId of context.parentMaps.get(personId)?.keys() ?? []){
		for(let childId of context.childrenByParent.get(parentId) ?? []){
			neighbourIds.add(childId)
		}
	}

	for(let entry of persons[personId]?.relations?.siblings ?? []){
		for(let siblingEntry of persons[entry.personId]?.relations?.siblings ?? []){
			if(siblingEntry.personId != null){
				neighbourIds.add(siblingEntry.personId)
			}
		}

		for(let parentEntry of persons[entry.personId]?.relations?.parents ?? []){
			if(parentEntry.personId != null){
				neighbourIds.add(parentEntry.personId)
			}
		}
	}

	for(let entry of persons[personId]?.relations?.partners ?? []){
		for(let childEntry of persons[entry.personId]?.relations?.children ?? []){
			if(childEntry.personId != null){
				neighbourIds.add(childEntry.personId)
			}
		}

		for(let parentEntry of persons[entry.personId]?.relations?.parents ?? []){
			if(parentEntry.personId != null){
				neighbourIds.add(parentEntry.personId)
			}
		}
	}

	for(let entry of persons[personId]?.relations?.parents ?? []){
		for(let partnerEntry of persons[entry.personId]?.relations?.partners ?? []){
			if(partnerEntry.personId != null){
				neighbourIds.add(partnerEntry.personId)
			}
		}
	}

	for(let childId of context.childrenByParent.get(personId) ?? []){
		neighbourIds.add(childId)

		for(let childParentId of context.parentMaps.get(childId)?.keys() ?? []){
			for(let siblingId of context.childrenByParent.get(childParentId) ?? []){
				neighbourIds.add(siblingId)
			}
		}
	}

	neighbourIds.delete(personId)

	return [...neighbourIds].filter((neighbourId) => persons[neighbourId])
}

// Works from the person outwards, a person whose relations changed is looked at again and sends everyone around them to be looked at, the context is built again after each change because what a person gained can be what the next person is worked out from, so a chain of siblings and parents is followed to the end in one run, the run stops when a pass changes nothing, no one is looked at more than a few times so a loop that never settles cannot freeze the page, the answer is whether anything changed anywhere, so the caller knows to save
function runRelationInference(startPersonId) {
	startPersonId = Number(startPersonId)

	if(!persons[startPersonId]){
		return false
	}

	let context = buildInferenceContext()
	let queue = [startPersonId, ...getRelationNeighbours(startPersonId, context)]
	let lookCounts = new Map()
	let hasChanged = false

	while(queue.length > 0){
		let personId = queue.shift()
		let lookCount = (lookCounts.get(personId) ?? 0) + 1

		lookCounts.set(personId, lookCount)

		if(lookCount > 5){
			continue
		}

		if(reconcileRelations(personId, context)){
			hasChanged = true
			context = buildInferenceContext()

			for(let neighbourId of [personId, ...getRelationNeighbours(personId, context)]){
				if(!queue.includes(neighbourId)){
					queue.push(neighbourId)
				}
			}
		}
	}

	return hasChanged
}

// A word that depends on the gender of the person it is about, a person with no gender, or a non-binary one, gets the neutral word
function pickGenderedWord(genderValue, femaleWord, maleWord, neutralWord) {
	if(genderValue == `female`){
		return femaleWord
	}

	return genderValue == `male` ? maleWord : neutralWord
}

function lowercaseFirst(text) {
	return `${text.charAt(0).toLowerCase()}${text.slice(1)}`
}

function uppercaseFirst(text) {
	return `${text.charAt(0).toUpperCase()}${text.slice(1)}`
}

// Mother, grandmother, great-grandmother, and from four generations up a number of times great, such as 2× great-grandmother
function getAncestorLabel(generations, genderValue) {
	let baseWord = pickGenderedWord(genderValue, `mother`, `father`, `parent`)
	let grandWord = pickGenderedWord(genderValue, `grandmother`, `grandfather`, `grandparent`)

	if(generations == 1){
		return uppercaseFirst(baseWord)
	}

	if(generations == 2){
		return uppercaseFirst(grandWord)
	}

	return generations == 3 ? `Great-${grandWord}` : `${generations - 2}\u00d7 great-${grandWord}`
}

function getDescendantLabel(generations, genderValue) {
	let baseWord = pickGenderedWord(genderValue, `daughter`, `son`, `child`)
	let grandWord = pickGenderedWord(genderValue, `granddaughter`, `grandson`, `grandchild`)

	if(generations == 1){
		return uppercaseFirst(baseWord)
	}

	if(generations == 2){
		return uppercaseFirst(grandWord)
	}

	return generations == 3 ? `Great-${grandWord}` : `${generations - 2}\u00d7 great-${grandWord}`
}

function getSiblingKinshipLabel(genderValue) {
	return uppercaseFirst(pickGenderedWord(genderValue, `sister`, `brother`, `sibling`))
}

// A sibling of an ancestor, the person is on a branch that left the line of the ancestors one generation below the shared one
function getAuntUncleLabel(up, genderValue) {
	if(up == 2){
		return pickGenderedWord(genderValue, `Aunt`, `Uncle`, `Parent\u2019s sibling`)
	}

	if(up == 3){
		return pickGenderedWord(genderValue, `Great-aunt`, `Great-uncle`, `Grandparent\u2019s sibling`)
	}

	return pickGenderedWord(genderValue, `${up - 2}\u00d7 great-aunt`, `${up - 2}\u00d7 great-uncle`, `Ancestor\u2019s sibling`)
}

// A descendant of a sibling
function getNieceNephewLabel(down, genderValue) {
	if(down == 2){
		return pickGenderedWord(genderValue, `Niece`, `Nephew`, `Sibling\u2019s child`)
	}

	if(down == 3){
		return pickGenderedWord(genderValue, `Great-niece`, `Great-nephew`, `Sibling\u2019s grandchild`)
	}

	return pickGenderedWord(genderValue, `${down - 2}\u00d7 great-niece`, `${down - 2}\u00d7 great-nephew`, `Sibling\u2019s descendant`)
}

// The degree of a cousin is how far both are from the shared ancestor, less one, and the difference between the two distances is how many times removed
function getCousinLabel(up, down) {
	let removal = Math.abs(up - down)
	let removalText = removal == 0 ? `` : removal == 1 ? ` once removed` : removal == 2 ? ` twice removed` : ` ${removal}\u00d7 removed`

	return `${getOrdinal(Math.min(up, down) - 1)} cousin${removalText}`
}

// A step link in the path makes the word a step word, a half sibling link makes a sibling a half sibling, and a non-biological link is added at the end
function applyKinshipQualifiers(label, steps, isSiblingLabel) {
	let qualifiedLabel = label

	if(steps.some((step) => step.subtype == `step`)){
		qualifiedLabel = `Step-${lowercaseFirst(qualifiedLabel)}`
	} else if(isSiblingLabel && steps.some((step) => step.subtype == `half`)){
		qualifiedLabel = `Half-${lowercaseFirst(qualifiedLabel)}`
	}

	return steps.some((step) => step.subtype == `non-biological`) ? `${qualifiedLabel} (non-biological)` : qualifiedLabel
}

// The shortest way from one person to another along active links, a link up is a parent, a link down is a child and a link across is a sibling, a way only climbs, then crosses to a sibling at most once, then only descends, so it never turns down and then climbs again through someone's other parent or partner, which is kept by following the person together with whether the way has turned down yet, a link up is only taken before the turn, a link across is only taken before the turn and is the turn, and a link down is always taken and is the turn, every step costs the same, a link that is not biological costs a little more, so when two ways are equally short the biological one is taken, the answer is the steps with the id of the person each one reaches, or null when there is no way, a way may also start with one partner link, before the blood part, and end with one partner link, after the blood part, but never cross a partner link in the middle, which is kept by following the stage of the way instead of only whether it has turned down, and a way that is only one partner link is a partner link
function findKinshipPath(startId, targetId) {
	let startKey = `${startId}:start`
	let distances = new Map([[startKey, 0]])
	let previousSteps = new Map()
	let visitedKeys = new Set()
	let kinds = {
		parents : `up`,
		siblings : `across`,
		partners : `partner`,
		children : `down`
	}
	let reachedKey = null

	while(true){
		let currentKey = null

		for(let [stateKey, distance] of distances){
			if(!visitedKeys.has(stateKey) && (currentKey === null || distance < distances.get(currentKey))){
				currentKey = stateKey
			}
		}

		if(currentKey === null){
			return null
		}

		let [currentIdText, currentStage] = currentKey.split(`:`)
		let currentId = Number(currentIdText)

		if(currentId === targetId){
			reachedKey = currentKey

			break
		}

		visitedKeys.add(currentKey)

		for(let role of relationRoles){
			let kind = kinds[role]
			let nextStage = getNextKinshipStage(currentStage, kind)

			if(!nextStage){
				continue
			}

			for(let entry of persons[currentId]?.relations?.[role] ?? []){
				let variant = getPreferredRelationVariant(entry)

				if(entry.personId == null || !persons[entry.personId] || !variant || !isActiveLink(role, currentId, entry.personId, variant.subtype)){
					continue
				}

				let nextKey = `${entry.personId}:${nextStage}`
				let distance = distances.get(currentKey) + 1000 + (variant.subtype == `biological` ? 0 : 1)

				if(!distances.has(nextKey) || distance < distances.get(nextKey)){
					distances.set(nextKey, distance)
					previousSteps.set(nextKey, {
						fromKey : currentKey,
						kind : kind,
						isPartnerStart : kind == `partner` && currentStage == `start`,
						subtype : variant.subtype,
						toId : entry.personId
					})
				}
			}
		}
	}

	let steps = []

	for(let stateKey = reachedKey; stateKey !== startKey; stateKey = previousSteps.get(stateKey).fromKey){
		steps.unshift(previousSteps.get(stateKey))
	}

	return steps
}

// Every way that findKinshipPath answers only climbs, then may cross to a sibling, then only descends, so it is one relationship, counted in generations up and down from the shared ancestor, a crossing counts as one generation up and one down, and the words come from the number of generations and the gender of the person at the end
function describeBloodKinshipSteps(steps) {
	let hasCrossing = steps.some((step) => step.kind == `across`)
	let up = steps.filter((step) => step.kind == `up`).length + (hasCrossing ? 1 : 0)
	let down = steps.filter((step) => step.kind == `down`).length + (hasCrossing ? 1 : 0)
	let genderValue = getPreferredGender(persons[steps.at(-1).toId])?.value ?? `unknown`
	let label = ``

	if(down == 0){
		label = getAncestorLabel(up, genderValue)
	} else if(up == 0){
		label = getDescendantLabel(down, genderValue)
	} else if(up == 1 && down == 1){
		label = getSiblingKinshipLabel(genderValue)
	} else if(down == 1){
		label = getAuntUncleLabel(up, genderValue)
	} else if(up == 1){
		label = getNieceNephewLabel(down, genderValue)
	} else {
		label = getCousinLabel(up, down)
	}

	return applyKinshipQualifiers(label, steps, up == 1 && down == 1)
}

// Where a way is after one more edge, a way starts at start, an edge to a partner at the start gives first, which is before the blood part, up keeps climbing, across and down turn, and an edge to a partner is only taken after the blood part, which gives end and nothing can follow, a way is never allowed to take a partner edge from first, because that would be two partner edges with no blood relationship between them, the answer is null when the edge is not allowed
function getNextKinshipStage(stage, kind) {
	if(stage == `end`){
		return null
	}

	if(kind == `partner`){
		if(stage == `start`){
			return `first`
		}

		return stage == `climb` || stage == `turned` ? `end` : null
	}

	if(kind == `up`){
		return stage == `turned` ? null : `climb`
	}

	if(kind == `across`){
		return stage == `turned` ? null : `turned`
	}

	return `turned`
}

// A married pair are spouses, a pair who have separated are ex-partners, and every other pair, including one whose kind of link is not known, are partners
function getPartnerKinshipWord(subtype) {
	if(subtype == `married`){
		return `Spouse`
	}

	return subtype == `separated` ? `Ex-partner` : `Partner`
}

// A way of one partner edge is just the word for it, any other way is described as the blood part, as before, with the partner word of the start in front and the partner word of the end behind, joined with possessives, such as Partner\u2019s grandfather, Grandfather\u2019s partner, Son\u2019s spouse and Partner\u2019s cousin
function describeKinshipSteps(steps) {
	if(steps.length == 1 && steps[0].kind == `partner`){
		return getPartnerKinshipWord(steps[0].subtype)
	}

	let startStep = steps[0].kind == `partner` ? steps[0] : null
	let endStep = steps.at(-1).kind == `partner` ? steps.at(-1) : null
	let bloodSteps = steps.filter((step) => step.kind != `partner`)
	let parts = [describeBloodKinshipSteps(bloodSteps)]

	if(startStep){
		parts.unshift(getPartnerKinshipWord(startStep.subtype))
	}

	if(endStep){
		parts.push(getPartnerKinshipWord(endStep.subtype))
	}

	return parts.map((part, index) => index == 0 ? part : lowercaseFirst(part)).join(`\u2019s `)
}

// How a person is related to the person on screen, for the search results, found along the shortest path of active links whatever the number of generations, a person who is not related in any way that is recorded is just a Person
function getKinshipLabel(targetId) {
	let activePersonId = activeHistory.at(-1)

	if(activePersonId == null || !persons[Number(targetId)]){
		return `Person`
	}

	if(Number(targetId) === Number(activePersonId)){
		return `Active person`
	}

	let steps = findKinshipPath(Number(activePersonId), Number(targetId))

	return steps && steps.length > 0 ? describeKinshipSteps(steps) : `Person`
}

// A person has a path to open in the search results when someone is on screen, the result is somebody else, and findKinshipPath finds a way of at least one step between them
function hasKinshipPath(targetId) {
	let activeId = activeHistory.at(-1)

	if(activeId == null || !persons[activeId] || !persons[Number(targetId)] || Number(targetId) === Number(activeId)){
		return false
	}

	let steps = findKinshipPath(Number(activeId), Number(targetId))

	return Boolean(steps && steps.length > 0)
}

// One step is described on its own, as the word for the person it reaches and the kind of link, the word is worked out from a copy of the step with a plain subtype, because describeKinshipSteps would otherwise put the kind in the word as well, such as Step-daughter and Half-sister, and Spouse for Partner, and the real kind is written after it, such as Daughter \u00b7 Step
function getKinshipStepDescription(step) {
	let plainStep = {
		...step,
		subtype : step.kind == `partner` ? `partner` : `biological`
	}

	return `${describeKinshipSteps([plainStep])} \u00b7 ${relationSubtypeLabels[step.subtype] ?? relationSubtypeLabels.unknown}`
}

// One row of the chain, the whole row opens the page of the person, and the name and the description are escaped because they are typed by the user
function buildKinshipStepHtml(personId, description) {
	let genderValue = getPreferredGender(persons[personId])?.value ?? `unknown`

	return `<div class="step" onclick="closeKinshipDialog(); viewPerson(${personId})"><div class="badge ${escapeHtml(genderValue)}"></div><div class="info"><div class="name">${escapeHtml(getNameLabel(persons[personId]))}</div><div class="meta">${escapeHtml(description)}</div></div></div>`
}

// Shows the shortest path from the person on screen to the target, the person on screen first and then everyone the path reaches, with an arrow between the rows, nothing opens when there is no path
function openKinshipDialog(targetId) {
	let activeId = activeHistory.at(-1)

	targetId = Number(targetId)

	if(activeId == null || !persons[activeId] || !persons[targetId]){
		return
	}

	let steps = findKinshipPath(Number(activeId), targetId)

	if(!steps || steps.length == 0){
		return
	}

	document.getElementById(`kinshipTitle`).textContent = getKinshipLabel(targetId)
	document.getElementById(`kinshipSummary`).innerHTML = `<div class="fine">${escapeHtml(getNameLabel(persons[activeId]))} \u2192 ${escapeHtml(getNameLabel(persons[targetId]))}</div>`
	document.getElementById(`kinshipChain`).innerHTML = [
		buildKinshipStepHtml(activeId, `Active person`),
		...steps.map((step) => buildKinshipStepHtml(step.toId, getKinshipStepDescription(step)))
	].join(`<div class="arrow">\u2193</div>`)

	if(!document.getElementById(`kinshipDialog`).open){
		document.getElementById(`kinshipDialog`).showModal()
	}
}

function closeKinshipDialog() {
	document.getElementById(`kinshipDialog`).close()
}

// Oldest first, by the starred birth date, the parts that are not known sort after the ones that are, so a year only comes before a full date of the same year, and a person written down as plain text has no birth to go by so they come after everyone who has a page
function getRelationSortKey(entry) {
	if(entry.personId == null){
		return [1, 9999, 13, 32]
	}

	let birth = getPreferredDate(persons[entry.personId], `birth`)

	return [0, birth?.year ?? 9999, birth?.month ?? 13, birth?.day ?? 32]
}

function compareRelationKeys(firstKey, secondKey) {
	for(let index = 0; index < firstKey.length; index++){
		if(firstKey[index] != secondKey[index]){
			return firstKey[index] - secondKey[index]
		}
	}

	return 0
}

function sortRelationEntries(entries) {
	return [...entries].sort((firstEntry, secondEntry) => compareRelationKeys(getRelationSortKey(firstEntry), getRelationSortKey(secondEntry)))
}

// An entry of a person who no longer exists is not drawn
function isRenderableRelationEntry(entry) {
	return entry.personId == null ? typeof entry.text == `string` : Boolean(persons[entry.personId])
}

// One relative in a list, the badge is a circle tinted by the gender with a silhouette that matches the role, a person only written down as text has a dashed circle, the name of a person with a page opens their page, the small mark after the name says the link disagrees with the parents entered with an exclamation mark or has been worked out from parents that changed with a question mark, the line underneath is the birth year and the kind of link, or only the kind of link when the year is not known, or Plain text and the kind of link, and a relative written as plain text has a button that makes a page for them
function buildRelationEntryHtml(ownerId, role, entry) {
	let isPlainText = entry.personId == null
	let person = isPlainText ? null : persons[entry.personId]
	let preferredGenderValue = person ? getPreferredGender(person)?.value : null
	let genderValue = genderOptions.some((option) => option.value === preferredGenderValue) ? preferredGenderValue : `unknown`
	let variant = getPreferredRelationVariant(entry)
	let birthYear = person ? getPreferredDate(person, `birth`)?.year : null
	let hasConflict = entry.variants.some((entryVariant) => entryVariant.hasConflict)
	let isQuestioned = entry.variants.some((entryVariant) => entryVariant.isQuestioned)
	let metaText = [isPlainText ? `Plain text` : birthYear ?? ``, variant ? relationSubtypeLabels[variant.subtype] ?? `` : ``].filter((part) => part !== ``).join(` \u00b7 `)
	let warningHtml = `${hasConflict ? `<span class="warning" title="This kind of link disagrees with the parents entered">!</span>` : ``}${isQuestioned ? `<span class="warning" title="The parents this was worked out from have changed">?</span>` : ``}`

	return `<div class="entry"><div class="badge ${role} ${genderValue}${isPlainText ? ` plain` : ``}"></div><div class="info"><div class="name${isPlainText ? `` : ` linked`}"${isPlainText ? `` : ` onclick="viewPerson(${entry.personId})"`}><span class="text">${escapeHtml(getRelationEntryLabel(entry))}</span>${warningHtml}${isPlainText ? `<span class="promote" onclick="promoteTextRelation(${ownerId}, ${escapeHtml(JSON.stringify(role))}, ${escapeHtml(JSON.stringify(entry.text))})">create profile</span>` : ``}</div><div class="meta">${escapeHtml(metaText)}</div></div></div>`
}

// The relations of the person on screen are drawn as three lists under the header, parents, siblings and children, each with a label that opens the dialog on that role, an empty list is one dash that opens the same dialog, and every list is sorted from the oldest to the youngest
function renderRelations(personId) {
	clearProfileFocus?.()

	let person = persons[personId]

	if(!person){
		clearRelations()

		return
	}

	document.getElementById(`relations`).innerHTML = relationRoles.map((role) => {
		let entries = sortRelationEntries((person.relations?.[role] ?? []).filter(isRenderableRelationEntry))

		return `<div class="role" data-role="${role}"><div class="heading" onclick="openRelationsDialog('${role}')"><span>${relationRoleLabels[role]}</span><span class="action">+ <u>e</u>dit</span></div><div class="entries">${entries.length == 0 ? `<div class="entry empty" onclick="openRelationsDialog('${role}')">\u2013</div>` : entries.map((entry) => buildRelationEntryHtml(personId, role, entry)).join(``)}</div></div>`
	}).join(``)
}

function clearRelations() {
	document.getElementById(`relations`).innerHTML = ``
}

// Everyone written down as plain text, found by their normalised name, so Zoe and ZOË are the same person here as they are everywhere else
function rebuildPlainTextRelationIndex() {
	plainTextRelationIndex = {}

	for(let [id, person] of Object.entries(persons)){
		for(let role of relationRoles){
			for(let entry of person.relations?.[role] ?? []){
				if(entry.personId == null && typeof entry.text == `string`){
					let key = normalizeNameText(entry.text)

					if(!plainTextRelationIndex[key]){
						plainTextRelationIndex[key] = []
					}

					plainTextRelationIndex[key].push({
						ownerId : Number(id),
						role : role,
						text : entry.text
					})
				}
			}
		}
	}
}

// A plain text entry is turned into the entry of a person with a page, the sources stay the same
function convertTextEntryToPerson(ownerId, role, entry, newPersonId) {
	let list = persons[ownerId].relations[role]

	list[list.indexOf(entry)] = {
		personId : newPersonId,
		variants : entry.variants,
		preferredVariantIndex : entry.preferredVariantIndex
	}
}

// Makes a page for someone who was only written down, the name is split at the last space into a first and a last name, the entry that was clicked becomes a link to the new page, and every other entry anywhere with the same name is offered one at a time, because a name is not always the same person, only an answer of OK links it, and then the two sides are mirrored, what can be worked out is worked out, and the page is drawn again
function promoteTextRelation(ownerId, role, text) {
	let owner = persons[ownerId]
	let entry = owner?.relations?.[role]?.find((relationEntry) => relationEntry.personId == null && relationEntry.text === text)

	if(!entry){
		return
	}

	let trimmedText = text.trim()
	let spaceIndex = trimmedText.lastIndexOf(` `)
	let ids = Object.keys(persons).map(Number)
	let newPersonId = ids.length > 0 ? Math.max(...ids) + 1 : 1
	let touchedIds = new Set([ownerId, newPersonId])

	persons[newPersonId] = {
		names : {
			preferredVariantIndex : 0,
			variants : [
				{
					firstName : spaceIndex == -1 ? trimmedText : trimmedText.slice(0, spaceIndex).trim(),
					lastName : spaceIndex == -1 ? null : trimmedText.slice(spaceIndex + 1).trim() || null,
					links : [],
					note : null
				}
			]
		}
	}

	let otherMatches = (plainTextRelationIndex[normalizeNameText(text)] ?? []).filter((match) => !(match.ownerId == ownerId && match.role == role))

	convertTextEntryToPerson(ownerId, role, entry, newPersonId)
	syncReciprocalRelation(ownerId, role, newPersonId)

	for(let match of otherMatches){
		let otherOwner = persons[match.ownerId]
		let otherEntry = otherOwner?.relations?.[match.role]?.find((relationEntry) => relationEntry.personId == null && relationEntry.text === match.text)

		if(!otherEntry || match.ownerId == newPersonId || getLinkedRole(otherOwner, newPersonId)){
			continue
		}

		if(!window.confirm(`Also link ${getNameLabel(otherOwner)}\u2019s ${relationRoleSingularLabels[match.role]} \u201c${match.text}\u201d to this new profile?`)){
			continue
		}

		convertTextEntryToPerson(match.ownerId, match.role, otherEntry, newPersonId)
		syncReciprocalRelation(match.ownerId, match.role, newPersonId)

		touchedIds.add(match.ownerId)
	}

	rebuildPlainTextRelationIndex()

	for(let touchedId of touchedIds){
		runRelationInference(touchedId)
	}

	saveData()
	viewPerson()
}

// When a person is deleted the people who had them as a relative keep the name as plain text with the sources that were typed in, an entry that only had inferred sources is dropped, links that were kept from being worked out for the deleted person are forgotten, the deleted person's own relations are cleared so they cannot bring anything back, and what can be worked out again is worked out for the people who are left
function unlinkPersonFromRelations(personId) {
	let deletedPerson = persons[personId]

	if(!deletedPerson){
		return
	}

	let nameText = getNameLabel(deletedPerson)
	let affectedIds = new Set()

	for(let [id, person] of Object.entries(persons)){
		if(Number(id) == personId || !person.relations){
			continue
		}

		for(let role of relationRoles){
			let list = person.relations[role]

			for(let index = list.length - 1; index >= 0; index--){
				let entry = list[index]

				if(entry.personId !== personId){
					continue
				}

				let manualVariants = getManualVariants(entry)

				affectedIds.add(Number(id))

				if(manualVariants.length == 0){
					list.splice(index, 1)

					continue
				}

				list[index] = {
					text : nameText,
					variants : manualVariants.map(copyVariantWithoutInference),
					preferredVariantIndex : Math.max(manualVariants.indexOf(entry.variants[entry.preferredVariantIndex]), 0)
				}
			}
		}

		if(Array.isArray(person.relations.blockedInferences)){
			person.relations.blockedInferences = person.relations.blockedInferences.filter((key) => !key.endsWith(`:${personId}`))
		}

		cleanupRelations(person)
	}

	delete deletedPerson.relations

	rebuildPlainTextRelationIndex()

	for(let affectedId of affectedIds){
		runRelationInference(affectedId)
	}
}

// The dialog is a copy of the lists of the person on screen, and a draft of the selected source is the one the boxes show
function getRelationsDraftEntries() {
	return relationsDraft.entries[relationsDraft.role]
}

function getSelectedRelationsEntry() {
	return getRelationsDraftEntries()[relationsDraft.selectedEntryIndex]
}

function getSelectedRelationsVariant() {
	return getSelectedRelationsEntry()?.variants[relationsDraft.selectedVariantIndex]
}

// A person can only be linked once to the person on screen, under one role, so someone already in any list of the draft is not offered again, except someone who is only there because the page worked it out, who can be given a typed source of their own
function getDraftLinkedRole(personId) {
	return relationRoles.find((role) => relationsDraft.entries[role].some((entry) => entry.personId === personId)) ?? null
}

function canLinkRelation(personId, activeId) {
	if(personId == activeId || !persons[personId]){
		return false
	}

	let linkedRole = getDraftLinkedRole(personId)

	if(!linkedRole){
		return true
	}

	let linkedEntry = relationsDraft.entries[linkedRole].find((entry) => entry.personId === personId)

	return linkedRole == relationsDraft.role && getManualVariants(linkedEntry).length == 0
}

// The selection goes to the first entry of the side on show and to its starred source
function selectFirstRelationsEntry() {
	relationsDraft.selectedEntryIndex = 0
	relationsDraft.selectedVariantIndex = getSelectedRelationsEntry()?.preferredVariantIndex ?? 0
}

// The dialog works on copies of all three lists, so Cancel throws every change away, it opens on the side that was asked for
function openRelationsDialog(initialRole = `parents`) {
	let person = persons[activeHistory.at(-1)]

	if(!person){
		return
	}

	relationsDraft.personId = activeHistory.at(-1)
	relationsDraft.role = initialRole
	relationsDraft.entries = {}
	relationsDraft.addedKeys = new Set()

	for(let role of relationRoles){
		relationsDraft.entries[role] = JSON.parse(JSON.stringify(person.relations?.[role] ?? [])).filter(isRenderableRelationEntry)
	}

	// The other parent of a child is whoever else is listed as a parent of that child, it is kept on the copy of the entry as coParent, with the one that was there when the dialog opened as originalCoParent, so saving knows whether it was changed or removed, neither is ever written to the person
	for(let entry of relationsDraft.entries.children){
		if(entry.personId == null){
			continue
		}

		let otherParentEntry = (persons[entry.personId]?.relations?.parents ?? []).find((parentEntry) => parentEntry.personId !== relationsDraft.personId && isRenderableRelationEntry(parentEntry))
		let coParent = !otherParentEntry ? null : otherParentEntry.personId != null ? { personId : otherParentEntry.personId } : { text : otherParentEntry.text }

		entry.coParent = coParent
		entry.originalCoParent = coParent ? { ...coParent } : null
	}

	selectFirstRelationsEntry()
	fillRelationsForm()
	renderRelationsDialog()

	document.getElementById(`relationsDialog`).showModal()
}

function closeRelations() {
	document.getElementById(`relationsDialog`).close()
}

// Writes the note and the links boxes into the selected source, a source worked out by the page is not edited
function syncRelationsFromForm() {
	let variant = getSelectedRelationsVariant()

	if(!variant || variant.isAutoInferred){
		return
	}

	let note = document.getElementById(`relationsNote`).value.trim()

	variant.note = note == `` ? null : note
	variant.links = readDynamicLinks(`relationsLinks`)
}

// The boxes always show the selected source, they are only filled when the selection changes so typing is never interrupted, the links are drawn with the rest of the editor
function fillRelationsForm() {
	let variant = getSelectedRelationsVariant()

	document.getElementById(`relationsNote`).value = variant?.note ?? ``
	document.getElementById(`relationsCoParentSearch`).value = ``
}

function renderRelationsDialog() {
	for(let role of relationRoles){
		document.getElementById(`${role}Tab`).className = role == relationsDraft.role ? `selected` : ``
	}

	document.getElementById(`openAddRelationButton`).textContent = `+ Add ${uppercaseFirst(relationRoleSingularLabels[relationsDraft.role])}`

	renderRelationsEntries()
	renderRelationsEditor()
}

// Every keystroke in the other boxes keeps the selected source up to date, and every keystroke in the search box of the other parent lists the people who match
function updateRelationsDialog(event) {
	if(event?.target.id == `relationsCoParentSearch`){
		renderCoParentSuggestions()

		return
	}

	syncRelationsFromForm()
	renderRelationsEditor()
}

// What the add dialog is asking for, the person or the words that are being added, the other parent when a child is being added, and the kind of link of the new entry, the dialog is a second dialog on top of the relations dialog and adds one entry to its copy of the lists
let addRelationDraft = {
	role : `parents`,
	target : null,
	coParent : null,
	previousCoParents : [],
	subtype : `unknown`
}

// Everyone who is already the other parent of a child of the person on screen, from the copy of the children in the relations dialog, and from the other parents listed on those children, a person with a page is counted once, and a name written as plain text is counted once for each spelling
function collectPreviousCoParents() {
	let previousCoParents = []
	let seenKeys = new Set()

	for(let entry of relationsDraft.entries.partners){
		let candidate = entry.personId != null ? { personId : entry.personId } : entry.isNew ? {
			isNew : true,
			firstName : entry.firstName ?? null,
			lastName : entry.lastName ?? null,
			gender : entry.gender ?? null,
			birth : entry.birth ?? null,
			death : entry.death ?? null,
			isDeceased : entry.isDeceased ?? false
		} : { text : entry.text }

		if(candidate.personId !== undefined && (!persons[candidate.personId] || candidate.personId === relationsDraft.personId)){
			continue
		}

		let key = getCoParentKey(candidate)

		if(!seenKeys.has(key)){
			seenKeys.add(key)
			previousCoParents.push(candidate)
		}
	}

	for(let entry of relationsDraft.entries.children){
		if(entry.personId == null && !entry.isNew){
			continue
		}

		let candidates = []

		if(entry.coParent){
			candidates.push(entry.coParent)
		}

		for(let parentEntry of persons[entry.personId]?.relations?.parents ?? []){
			if(parentEntry.personId !== relationsDraft.personId && isRenderableRelationEntry(parentEntry)){
				candidates.push(parentEntry.personId != null ? { personId : parentEntry.personId } : { text : parentEntry.text })
			}
		}

		for(let candidate of candidates){
			let isPerson = candidate.personId !== undefined

			if(isPerson && (!persons[candidate.personId] || candidate.personId === relationsDraft.personId)){
				continue
			}

			let key = getCoParentKey(candidate)

			if(!seenKeys.has(key)){
				seenKeys.add(key)
				previousCoParents.push(candidate)
			}
		}
	}

	return previousCoParents
}

function getCoParentLabel(coParent) {
	if(coParent.personId !== undefined){
		return getNameLabel(persons[coParent.personId])
	}

	return coParent.isNew ? getPendingPersonName(coParent) : coParent.text
}

// Opens on the side that is on show in the relations dialog, with nothing chosen and the kind of link not known
function openAddRelationDialog() {
	syncRelationsFromForm()

	let role = relationsDraft.role

	addRelationDraft = {
		role : role,
		target : null,
		coParent : null,
		previousCoParents : role == `children` ? collectPreviousCoParents() : [],
		subtype : `unknown`
	}

	document.getElementById(`addRelationTitle`).textContent = `Add ${relationRoleSingularLabels[role]}`
	document.getElementById(`addRelationSearch`).value = ``
	document.getElementById(`addCoParentSearch`).value = ``
	document.getElementById(`addRelationIssue`).textContent = ``

	renderAddRelationDialog()

	document.getElementById(`addRelationDialog`).showModal()
}

function closeAddRelationDialog() {
	document.getElementById(`addRelationDialog`).close()
}

function renderAddRelationDialog() {
	renderAddRelationTarget()
	renderAddCoParent()
	renderAddRelationChoices()
}

// Every keystroke in either search box lists the people who match
function updateAddRelationDialog(event) {
	let id = event?.target.id ?? ``

	if(id == `addRelationSearch`){
		renderAddRelationSuggestions()
	} else if(id == `addCoParentSearch`){
		renderAddCoParentSuggestions()
	} else if(id.startsWith(`addTargetNew`)){
		updateNewPersonSummary(`target`)
	} else if(id.startsWith(`addCoParentNew`)){
		updateNewPersonSummary(`coParent`)
	}
}

// The chosen person or name is shown as a row that can be removed, and the search box is only there while nothing is chosen
function renderAddRelationTarget() {
	let target = addRelationDraft.target

	document.getElementById(`addRelationSelected`).innerHTML = !target ? `` : `<div class="entry person"><span class="text">${escapeHtml(getCoParentLabel(target))}${target.isNew ? ` (new)` : ``}</span><span class="meta">${target.isNew ? `New` : `Person`}</span><span class="remove" onclick="clearAddRelationTarget()">remove</span></div>`
	document.getElementById(`addRelationSearch`).hidden = Boolean(target)

	renderAddRelationSuggestions()
	renderNewPersonFields(`target`)
}

// The people who match what is typed, the person on screen and anyone already linked to them under any role are not offered, and the words are offered as a new person to create
function renderAddRelationSuggestions() {
	let suggestionsElement = document.getElementById(`addRelationSuggestions`)
	let text = document.getElementById(`addRelationSearch`).value.trim()

	if(addRelationDraft.target || text == ``){
		suggestionsElement.innerHTML = ``

		return
	}

	let terms = splitSearchTerms(text)
	let personMatches = findPersonMatches(terms)
		.filter((match) => persons[Number(match.id)] && Number(match.id) != relationsDraft.personId && !getDraftLinkedRole(Number(match.id)))
		.slice(0, 8)

	suggestionsElement.innerHTML = `${personMatches.map((match) => `<div class="entry person" data-person onclick="setAddRelationTargetPerson(${match.id})"><span class="text">${buildHighlightHtml(match.text, terms)}</span><span class="meta">Person</span></div>`).join(``)}<div class="entry person" onclick="setAddRelationTargetNew()"><span class="text">Create new person \u201c${escapeHtml(text)}\u201d</span><span class="meta">New</span></div>`
}

// A person can only be linked once to the person on screen, under one role, and the other parent can not be the child
function setAddRelationTargetPerson(personId) {
	if(!persons[personId] || personId == relationsDraft.personId || getDraftLinkedRole(personId)){
		return
	}

	addRelationDraft.target = { personId : personId }

	if(addRelationDraft.coParent?.personId === personId){
		addRelationDraft.coParent = null
	}

	document.getElementById(`addRelationSearch`).value = ``
	document.getElementById(`addRelationIssue`).textContent = ``

	renderAddRelationDialog()
}

// A person who does not exist yet is only an object in the draft, { isNew, firstName, lastName, gender, birth, death, isDeceased }, nothing is added to the people until the relations dialog is saved, so cancelling either dialog leaves nothing behind, gender is the value of one of the options or null, and birth and death are { day, month, year } as typed or null when nothing was typed
function getNewPersonFromText(text) {
	let trimmedText = text.trim()
	let spaceIndex = trimmedText.lastIndexOf(` `)

	return {
		isNew : true,
		firstName : spaceIndex == -1 ? trimmedText : trimmedText.slice(0, spaceIndex).trim(),
		lastName : spaceIndex == -1 ? null : trimmedText.slice(spaceIndex + 1).trim() || null,
		gender : null,
		birth : null,
		death : null,
		isDeceased : false
	}
}

function getPendingPersonName(pendingPerson) {
	return [pendingPerson.firstName, pendingPerson.lastName].filter((part) => part).join(` `)
}

// The quick-create panel of the person being added, which is either the person being linked or their other parent, each has its own boxes, named with a prefix
function getNewPersonFieldPrefix(which) {
	return which == `target` ? `addTargetNew` : `addCoParentNew`
}

// Builds the boxes of the panel from the pending person with the same helper that the new person dialog uses, which is only done when the panel opens, so typing is never interrupted
function fillNewPersonForm(which) {
	let pendingPerson = addRelationDraft[which]

	document.getElementById(which == `target` ? `addRelationNewPersonFields` : `addCoParentNewPersonFields`).innerHTML = buildPersonCreateHtml(getNewPersonFieldPrefix(which), pendingPerson)

	renderNewPersonFields(which)
}

// Writes the boxes into the pending person and answers what is wrong with it, read and judged by the same helpers as the new person dialog
function syncNewPersonFromForm(which) {
	let pendingPerson = addRelationDraft[which]

	Object.assign(pendingPerson, readPersonCreateState(getNewPersonFieldPrefix(which)))

	return getPersonCreateIssue(pendingPerson)
}

// Shows the panel when the person is a pending new one and hides it otherwise, the deceased box and the red name boxes are kept up to date by the shared helper, the gender buttons and the text of what is wrong belong to the shared helpers as well
function renderNewPersonFields(which) {
	let pendingPerson = addRelationDraft[which]
	let containerElement = document.getElementById(which == `target` ? `addRelationNewPersonFields` : `addCoParentNewPersonFields`)

	containerElement.hidden = !pendingPerson?.isNew

	if(!pendingPerson?.isNew){
		return
	}

	updatePersonCreateForm(getNewPersonFieldPrefix(which))
}

// Every keystroke in the panel keeps the pending person up to date, and the chip that shows its name
function updateNewPersonSummary(which) {
	syncNewPersonFromForm(which)

	if(which == `target`){
		renderAddRelationTarget()
	} else {
		renderAddCoParent()
	}
}

function setAddRelationTargetNew() {
	let text = document.getElementById(`addRelationSearch`).value.trim()

	if(text == ``){
		return
	}

	addRelationDraft.target = getNewPersonFromText(text)

	document.getElementById(`addRelationSearch`).value = ``
	document.getElementById(`addRelationIssue`).textContent = ``

	renderAddRelationDialog()
	fillNewPersonForm(`target`)
}

function clearAddRelationTarget() {
	addRelationDraft.target = null

	renderAddRelationDialog()
}

// Enter picks the first person in the list or otherwise creates a new person from the words, and it never adds the entry
function handleAddRelationSearchKey(event) {
	if(event.key != `Enter`){
		return
	}

	event.preventDefault()

	let firstPerson = document.querySelector(`#addRelationSuggestions>.entry[data-person]`)

	if(firstPerson){
		firstPerson.click()
	} else {
		setAddRelationTargetNew()
	}
}

// The other parent is asked for whenever a child is being added, whether the child already has a page or is about to get one, the people who are already the other parent of a child are one click each, and anyone else can be searched for
function renderAddCoParent() {
	let isShown = addRelationDraft.role == `children`
	let childId = addRelationDraft.target?.personId
	let coParent = addRelationDraft.coParent
	let pills = addRelationDraft.previousCoParents.filter((previousCoParent) => previousCoParent.personId === undefined || previousCoParent.personId !== childId)

	document.getElementById(`addCoParentSection`).hidden = !isShown

	if(!isShown){
		return
	}

	document.getElementById(`addPreviousCoParents`).innerHTML = pills
		.map((previousCoParent, index) => `<div class="choice${isSameCoParent(previousCoParent, coParent) ? ` selected` : ``}" onclick="chooseAddPreviousCoParent(${addRelationDraft.previousCoParents.indexOf(previousCoParent)})">${escapeHtml(getCoParentLabel(previousCoParent))}</div>`)
		.join(``)
	document.getElementById(`addCoParentSelected`).innerHTML = !coParent ? `` : `<div class="entry person"><span class="text">${escapeHtml(getCoParentLabel(coParent))}${coParent.isNew ? ` (new)` : coParent.text !== undefined ? ` (plain text)` : ``}</span><span class="meta">${coParent.isNew ? `New` : coParent.text !== undefined ? `Text` : `Person`}</span><span class="remove" onclick="clearAddCoParent()">remove</span></div>`
	document.getElementById(`addCoParentSearch`).hidden = Boolean(coParent)

	renderAddCoParentSuggestions()
	renderNewPersonFields(`coParent`)
}

// Choosing the other parent who is already chosen clears them again
function chooseAddPreviousCoParent(index) {
	let previousCoParent = addRelationDraft.previousCoParents[index]

	addRelationDraft.coParent = isSameCoParent(previousCoParent, addRelationDraft.coParent) ? null : JSON.parse(JSON.stringify(previousCoParent))

	renderAddCoParent()

	if(addRelationDraft.coParent?.isNew){
		fillNewPersonForm(`coParent`)
	}
}

// The people who match what is typed, the person on screen and the child are not offered
function renderAddCoParentSuggestions() {
	let suggestionsElement = document.getElementById(`addCoParentSuggestions`)
	let text = document.getElementById(`addCoParentSearch`).value.trim()

	if(addRelationDraft.coParent || text == ``){
		suggestionsElement.innerHTML = ``

		return
	}

	let terms = splitSearchTerms(text)
	let personMatches = findPersonMatches(terms)
		.filter((match) => persons[Number(match.id)] && Number(match.id) != relationsDraft.personId && Number(match.id) != addRelationDraft.target?.personId)
		.slice(0, 8)

	suggestionsElement.innerHTML = `${personMatches.map((match) => `<div class="entry person" data-person onclick="setAddCoParentPerson(${match.id})"><span class="text">${buildHighlightHtml(match.text, terms)}</span><span class="meta">Person</span></div>`).join(``)}<div class="entry person" onclick="setAddCoParentNew()"><span class="text">Create new person \u201c${escapeHtml(text)}\u201d</span><span class="meta">New</span></div>`
}

function setAddCoParentPerson(personId) {
	if(!persons[personId] || personId == relationsDraft.personId || personId == addRelationDraft.target?.personId){
		return
	}

	addRelationDraft.coParent = { personId : personId }

	document.getElementById(`addCoParentSearch`).value = ``

	renderAddCoParent()
}

function setAddCoParentNew() {
	let text = document.getElementById(`addCoParentSearch`).value.trim()

	if(text == ``){
		return
	}

	addRelationDraft.coParent = getNewPersonFromText(text)

	document.getElementById(`addCoParentSearch`).value = ``

	renderAddCoParent()
	fillNewPersonForm(`coParent`)
}

function clearAddCoParent() {
	addRelationDraft.coParent = null

	renderAddCoParent()
}

// Enter picks the first person in the list or otherwise creates a new person from the words, and it never adds the entry
function handleAddCoParentSearchKey(event) {
	if(event.key != `Enter`){
		return
	}

	event.preventDefault()

	let firstPerson = document.querySelector(`#addCoParentSuggestions>.entry[data-person]`)

	if(firstPerson){
		firstPerson.click()
	} else {
		setAddCoParentNew()
	}
}

// The kind of link of the new entry is chosen here, so the entry is complete when it is added, choosing the one that is already chosen goes back to unknown
function renderAddRelationChoices() {
	document.getElementById(`addRelationSubtypeChoices`).innerHTML = relationSubtypes[addRelationDraft.role]
		.map((subtype, index) => `<div class="choice${subtype === addRelationDraft.subtype ? ` selected` : ``}" onclick="chooseAddRelationSubtype(${index})">${relationSubtypeLabels[subtype]}</div>`)
		.join(``)
}

function chooseAddRelationSubtype(index) {
	let subtype = relationSubtypes[addRelationDraft.role][index]

	addRelationDraft.subtype = addRelationDraft.subtype == subtype ? `unknown` : subtype

	renderAddRelationChoices()
}

// Adds the new entry to the copy of the list in the relations dialog, with one typed source that has the kind of link chosen, a child with a page gets the other parent that was chosen, the new entry is selected in the relations dialog, which is drawn again, and nothing reaches the person until that dialog is saved, a person with a page who is added is remembered in addedKeys, because adding someone by hand lets the page work out their link again
function confirmAddRelation(event) {
	event.preventDefault()

	let target = addRelationDraft.target

	if(!target){
		document.getElementById(`addRelationIssue`).textContent = `\u26a0 Choose a person or type a name first.`

		return
	}

	if(target.personId !== undefined && (!persons[target.personId] || getDraftLinkedRole(target.personId))){
		document.getElementById(`addRelationIssue`).textContent = `\u26a0 This person is already linked.`

		return
	}

	let issue = target.isNew ? syncNewPersonFromForm(`target`) : ``

	if(issue != ``){
		showPersonCreateIssue(getNewPersonFieldPrefix(`target`), issue)

		return
	}

	if(addRelationDraft.role == `children` && addRelationDraft.coParent?.isNew){
		issue = syncNewPersonFromForm(`coParent`)

		if(issue != ``){
			showPersonCreateIssue(getNewPersonFieldPrefix(`coParent`), issue, `Other parent: `)

			return
		}
	}

	syncRelationsFromForm()

	let role = addRelationDraft.role
	let entries = relationsDraft.entries[role]
	let variant = {
		...getBlankRelationVariant(),
		subtype : addRelationDraft.subtype
	}
	let entry = target.personId !== undefined ? {
		personId : target.personId,
		variants : [variant],
		preferredVariantIndex : 0
	} : {
		...JSON.parse(JSON.stringify(target)),
		variants : [variant],
		preferredVariantIndex : 0
	}

	if(role == `children`){
		entry.coParent = addRelationDraft.coParent ? JSON.parse(JSON.stringify(addRelationDraft.coParent)) : null
		entry.originalCoParent = null
	}

	entries.push(entry)

	if(target.personId !== undefined){
		relationsDraft.addedKeys.add(buildBlockedInferenceKey(role, target.personId))
	}

	relationsDraft.role = role
	relationsDraft.selectedEntryIndex = entries.length - 1
	relationsDraft.selectedVariantIndex = 0

	closeAddRelationDialog()
	fillRelationsForm()
	renderRelationsDialog()
}

// Changing side keeps what was typed on the side being left
function switchRelationsRole(role) {
	if(role == relationsDraft.role){
		return
	}

	syncRelationsFromForm()

	relationsDraft.role = role

	selectFirstRelationsEntry()
	fillRelationsForm()
	renderRelationsDialog()
}

function selectRelationsEntry(index) {
	syncRelationsFromForm()

	relationsDraft.selectedEntryIndex = index
	relationsDraft.selectedVariantIndex = getSelectedRelationsEntry().preferredVariantIndex

	fillRelationsForm()
	renderRelationsEntries()
	renderRelationsEditor()
}

function selectRelationsVariant(index) {
	syncRelationsFromForm()

	relationsDraft.selectedVariantIndex = index

	fillRelationsForm()
	renderRelationsEditor()
}

// Takes a whole entry out of the copy, the sources that were typed in and the ones the page worked out, nothing is lost for good because Cancel throws the copy away, when the page had worked the link out, saving records that it must not be worked out again until the person is added by hand, the click is stopped from reaching the row
function removeRelationsEntry(event, index) {
	event.stopPropagation()
	syncRelationsFromForm()

	let entries = getRelationsDraftEntries()

	entries.splice(index, 1)

	relationsDraft.selectedEntryIndex = Math.min(relationsDraft.selectedEntryIndex, Math.max(entries.length - 1, 0))
	relationsDraft.selectedVariantIndex = entries[relationsDraft.selectedEntryIndex]?.preferredVariantIndex ?? 0

	fillRelationsForm()
	renderRelationsDialog()
}

// A new source is added to the selected entry and selected
function addRelationsVariant() {
	let entry = getSelectedRelationsEntry()

	if(!entry){
		return
	}

	syncRelationsFromForm()

	entry.variants.push(getBlankRelationVariant())

	relationsDraft.selectedVariantIndex = entry.variants.length - 1

	fillRelationsForm()
	renderRelationsEditor()
}

// The star is inside a row that selects itself when clicked, so the click is stopped from reaching the row
function starRelationsVariant(event, index) {
	event.stopPropagation()

	getSelectedRelationsEntry().preferredVariantIndex = index

	renderRelationsEntries()
	renderRelationsEditor()
}

// Any source can be removed, a typed one or one the page worked out, the star and the selection follow their sources, the star falls back to the first source when its own is removed, and an entry with no source left is removed
function removeRelationsVariant(event, index) {
	event.stopPropagation()
	syncRelationsFromForm()

	let entries = getRelationsDraftEntries()
	let entry = getSelectedRelationsEntry()

	entry.variants.splice(index, 1)

	if(entry.variants.length == 0){
		entries.splice(relationsDraft.selectedEntryIndex, 1)

		relationsDraft.selectedEntryIndex = Math.min(relationsDraft.selectedEntryIndex, Math.max(entries.length - 1, 0))
		relationsDraft.selectedVariantIndex = entries[relationsDraft.selectedEntryIndex]?.preferredVariantIndex ?? 0
	} else {
		if(entry.preferredVariantIndex == index){
			entry.preferredVariantIndex = 0
		} else if(entry.preferredVariantIndex > index){
			entry.preferredVariantIndex -= 1
		}

		if(relationsDraft.selectedVariantIndex > index){
			relationsDraft.selectedVariantIndex -= 1
		}

		relationsDraft.selectedVariantIndex = Math.min(relationsDraft.selectedVariantIndex, entry.variants.length - 1)
	}

	fillRelationsForm()
	renderRelationsDialog()
}

function chooseRelationSubtype(index) {
	let variant = getSelectedRelationsVariant()

	if(!variant || variant.isAutoInferred){
		return
	}

	variant.subtype = relationSubtypes[relationsDraft.role][index]

	renderRelationsEntries()
	renderRelationsEditor()
}

// The entries of the side on show, the selected one is marked, the small mark after the kind of link is the same as in the cluster, and every entry can be removed
function renderRelationsEntries() {
	let entries = getRelationsDraftEntries()

	document.getElementById(`relationsEntries`).innerHTML = entries.length == 0 ? `` : `<div class="heading"><span>Entered ${relationRoleLabels[relationsDraft.role].toLowerCase()}</span></div>${entries.map((entry, index) => {
		let variant = getPreferredRelationVariant(entry)
		let hasConflict = entry.variants.some((entryVariant) => entryVariant.hasConflict)
		let isQuestioned = entry.variants.some((entryVariant) => entryVariant.isQuestioned)

		return `<div class="entry person${index == relationsDraft.selectedEntryIndex ? ` selected` : ``}" onclick="selectRelationsEntry(${index})"><span class="text">${escapeHtml(getRelationEntryLabel(entry))}${entry.isNew ? ` (new)` : entry.personId == null ? ` (plain text)` : ``}</span><span class="meta">${variant ? relationSubtypeLabels[variant.subtype] ?? `` : ``}${hasConflict ? ` !` : ``}${isQuestioned ? ` ?` : ``}</span><span class="remove" onclick="removeRelationsEntry(event, ${index})">remove</span></div>`
	}).join(``)}`
}

// The sources of the selected entry with the star, then the boxes for the selected source with the note first and the links under it, a source worked out by the page cannot be edited and says so, and a source that disagrees with the parents or that was worked out from parents that changed says so as well, the links are only redrawn when they are not the ones in the boxes already
function renderRelationsEditor() {
	let entry = getSelectedRelationsEntry()
	let variant = getSelectedRelationsVariant()
	let role = relationsDraft.role
	let variantsElement = document.getElementById(`relationsVariants`)
	let isEditable = Boolean(variant) && !variant.isAutoInferred

	variantsElement.innerHTML = !entry ? `` : `<div class="heading"><span>Entered sources \u00b7 ${escapeHtml(getRelationEntryLabel(entry))}</span><span class="action" onclick="addRelationsVariant()">+ add another</span></div>${entry.variants.map((entryVariant, index) => {
		return `<div class="entry${index == relationsDraft.selectedVariantIndex ? ` selected` : ``}" onclick="selectRelationsVariant(${index})"><span class="star" onclick="starRelationsVariant(event, ${index})">${index == entry.preferredVariantIndex ? `\u2605` : `\u2606`}</span><span class="text">${relationSubtypeLabels[entryVariant.subtype] ?? `Unknown`}${entryVariant.hasConflict ? ` !` : ``}${entryVariant.isQuestioned ? ` ?` : ``}</span><span class="meta">${entryVariant.isAutoInferred || entryVariant.hasInference === true ? `Inferred` : ``}</span><span class="remove" onclick="removeRelationsVariant(event, ${index})">remove</span>${buildRelationVariantExtraHtml(entryVariant)}</div>`
	}).join(``)}`

	document.getElementById(`relationsSubtypeHeading`).textContent = isEditable ? `Kind of link` : ``
	document.getElementById(`relationsSubtypeChoices`).innerHTML = !isEditable ? `` : relationSubtypes[role]
		.map((subtype, index) => `<div class="choice${subtype === variant.subtype ? ` selected` : ``}" onclick="chooseRelationSubtype(${index})">${relationSubtypeLabels[subtype]}</div>`)
		.join(``)

	document.getElementById(`relationsNote`).hidden = !isEditable
	document.getElementById(`relationsLinks`).hidden = !isEditable

	renderDynamicLinks(`relationsLinks`, variant?.links ?? [], () => updateRelationsDialog())

	let noticeElement = document.getElementById(`relationsNotice`)
	let noticeParts = []

	if(variant?.isAutoInferred){
		noticeParts.push(`Worked out from the parents that were entered, it updates itself, give a source of your own with + add another, removing it stops it being worked out again until this person is added by hand.`)
	}

	if(variant?.hasInference){
		noticeParts.push(`The page also worked this kind of link out from the parents that were entered, it is shown with your source and updates itself, removing the source stops it being worked out again until this person is added by hand.`)
	}

	if(variant?.hasConflict){
		noticeParts.push(`This kind of link disagrees with what the parents entered for these two people say.`)
	}

	if(variant?.isQuestioned){
		noticeParts.push(`The parents this was worked out from have changed, check that it still holds.`)
	}

	noticeElement.textContent = noticeParts.join(` `)
	noticeElement.className = variant?.hasConflict || variant?.isQuestioned ? `notice warning` : `notice`

	renderCoParentField()
}

// The other parent is only asked for when a child who has a page, or who is about to get one, is selected on the children side, a child written as plain text has no page to hold parents
function getSelectedCoParentChild() {
	if(relationsDraft.role != `children`){
		return null
	}

	let entry = getSelectedRelationsEntry()

	return entry && (entry.personId != null || entry.isNew) ? entry : null
}

// Shows the chosen other parent with a way to remove them, or when there is none the search box, the people who match are listed by renderCoParentSuggestions
function renderCoParentField() {
	let entry = getSelectedCoParentChild()
	let editorElement = document.getElementById(`relationsCoParentEditor`)

	editorElement.hidden = !entry

	if(!entry){
		return
	}

	let coParent = entry.coParent ?? null

	document.getElementById(`relationsCoParentSelected`).innerHTML = !coParent ? `` : `<div class="entry person"><span class="text">${escapeHtml(getCoParentLabel(coParent))}${coParent.isNew ? ` (new)` : coParent.text !== undefined ? ` (plain text)` : ``}</span><span class="meta">${coParent.isNew ? `New` : coParent.text !== undefined ? `Text` : `Person`}</span><span class="remove" onclick="clearChildCoParent()">remove</span></div>`
	document.getElementById(`relationsCoParentSearch`).hidden = Boolean(coParent)

	renderCoParentSuggestions()
}

// The people who match what is typed, the same as the main search box, the person on screen and the child are not offered, because neither can be the other parent of the child
function renderCoParentSuggestions() {
	let entry = getSelectedCoParentChild()
	let suggestionsElement = document.getElementById(`relationsCoParentSuggestions`)
	let text = document.getElementById(`relationsCoParentSearch`).value.trim()

	if(!entry || entry.coParent || text == ``){
		suggestionsElement.innerHTML = ``

		return
	}

	let terms = splitSearchTerms(text)
	let personMatches = findPersonMatches(terms)
		.filter((match) => persons[Number(match.id)] && Number(match.id) != relationsDraft.personId && Number(match.id) != entry.personId)
		.slice(0, 8)

	suggestionsElement.innerHTML = personMatches.map((match) => `<div class="entry person" data-person onclick="setChildCoParentPerson(${match.id})"><span class="text">${buildHighlightHtml(match.text, terms)}</span><span class="meta">Person</span></div>`).join(``)
}

function setChildCoParentPerson(personId) {
	let entry = getSelectedCoParentChild()

	if(!entry || !persons[personId] || personId == relationsDraft.personId || personId == entry.personId){
		return
	}

	entry.coParent = { personId : personId }

	document.getElementById(`relationsCoParentSearch`).value = ``

	renderCoParentField()
}

function clearChildCoParent() {
	let entry = getSelectedCoParentChild()

	if(!entry){
		return
	}

	entry.coParent = null

	renderCoParentField()
}

// Enter picks the first person in the list, and it never saves the dialog
function handleCoParentSearchKey(event) {
	if(event.key != `Enter`){
		return
	}

	event.preventDefault()

	document.querySelector(`#relationsCoParentSuggestions>.entry[data-person]`)?.click()
}

// Two other parents are the same when they are the same person, or the same name written as plain text
function isSameCoParent(firstCoParent, secondCoParent) {
	if(!firstCoParent || !secondCoParent){
		return !firstCoParent && !secondCoParent
	}

	return getCoParentKey(firstCoParent) == getCoParentKey(secondCoParent)
}

// What tells one other parent from another, the person, or the name of someone about to be created, or the name written as plain text, a pending new person is never the same as a person who already has a page
function getCoParentKey(coParent) {
	if(coParent.personId !== undefined){
		return `p${coParent.personId}`
	}

	return `${coParent.isNew ? `n` : `t`}${normalizeNameText(coParent.isNew ? getPendingPersonName(coParent) : coParent.text)}`
}

// The source of the link between the person on screen and the child, which the other parent gets as well, it is the starred source when that was typed in, otherwise the first one that was typed in, otherwise an empty one
function getCoParentTemplateVariant(activeId, childId) {
	let childEntry = findRelationEntry(persons[activeId], `children`, childId)
	let preferredVariant = childEntry ? getPreferredRelationVariant(childEntry) : null
	let templateVariant = preferredVariant && !preferredVariant.isAutoInferred ? preferredVariant : childEntry ? getManualVariants(childEntry)[0] : null
	let copy = copyVariantWithoutInference(templateVariant ?? getBlankRelationVariant())

	delete copy.hasConflict

	return copy
}

// Makes sure a person has a typed link to another in a role, with the given source, a link that is already typed is left as it is, so nothing is ever listed twice, a person who is linked to the other under a different role is left alone, adding the link by hand lets the page work it out again, and the other side is mirrored
function ensureManualRelation(ownerId, role, targetId, templateVariant) {
	let owner = persons[ownerId]

	if(!owner || !persons[targetId]){
		return
	}

	let linkedRole = getLinkedRole(owner, targetId)

	if(linkedRole && linkedRole != role){
		return
	}

	let entry = findRelationEntry(owner, role, targetId)

	if(!entry){
		entry = {
			personId : targetId,
			variants : [],
			preferredVariantIndex : 0
		}

		ensureRelations(owner)[role].push(entry)
	}

	if(getManualVariants(entry).length == 0){
		unblockInference(owner, role, targetId)

		entry.variants = [{ ...templateVariant }, ...entry.variants]
		entry.preferredVariantIndex = 0
	}

	syncReciprocalRelation(ownerId, role, targetId)
}

// Takes an other parent that was there when the dialog opened off the child, the typed sources go and the ones the page worked out stay, and the other side is taken out as well
function removeCoParentLink(childId, coParent) {
	let child = persons[childId]

	if(!child){
		return
	}

	if(coParent.personId !== undefined){
		let entry = findRelationEntry(child, `parents`, coParent.personId)

		if(entry){
			let preferredVariant = entry.variants[entry.preferredVariantIndex]

			entry.variants = entry.variants.filter((variant) => variant.isAutoInferred)

			if(entry.variants.length == 0){
				child.relations.parents = child.relations.parents.filter((parentEntry) => parentEntry !== entry)
			} else {
				entry.preferredVariantIndex = Math.max(entry.variants.indexOf(preferredVariant), 0)
			}
		}

		removeReciprocalRelation(childId, `parents`, coParent.personId)
	} else if(child.relations?.parents){
		child.relations.parents = child.relations.parents.filter((parentEntry) => !(parentEntry.personId == null && normalizeNameText(parentEntry.text) == normalizeNameText(coParent.text)))
	}

	cleanupRelations(child)
}

// What a saved child asks for in the other parent field, a removed or changed other parent is taken off first, a person with a page is linked both ways with the source of the child, and a name written as plain text is added to the parents of the child unless the same name is already there
function applyChildCoParent(entry, activeId, touchedIds) {
	let childId = entry.personId
	let coParent = entry.coParent ?? null
	let originalCoParent = entry.originalCoParent ?? null

	if(!persons[childId]){
		return
	}

	if(originalCoParent && !isSameCoParent(originalCoParent, coParent)){
		removeCoParentLink(childId, originalCoParent)

		touchedIds.add(childId)

		if(originalCoParent.personId !== undefined){
			touchedIds.add(originalCoParent.personId)
		}
	}

	if(!coParent){
		return
	}

	let templateVariant = getCoParentTemplateVariant(activeId, childId)

	if(coParent.personId !== undefined){
		if(!persons[coParent.personId] || coParent.personId === activeId || coParent.personId === childId){
			return
		}

		ensureManualRelation(coParent.personId, `children`, childId, templateVariant)
		ensureManualRelation(childId, `parents`, coParent.personId, templateVariant)

		touchedIds.add(coParent.personId)
		touchedIds.add(childId)
	} else if(coParent.text){
		let child = persons[childId]
		let isAlreadyListed = (child.relations?.parents ?? []).some((parentEntry) => parentEntry.personId == null && normalizeNameText(parentEntry.text) == normalizeNameText(coParent.text))

		if(!isAlreadyListed){
			ensureRelations(child).parents.push({
				text : coParent.text,
				variants : [{ ...templateVariant }],
				preferredVariantIndex : 0
			})
		}

		touchedIds.add(childId)
	}
}

// Makes a page for a pending new person, with the name and whatever else was filled in, the gender, a birth date, a death date, or the mark that they are deceased with no date, none of it has a link or a note, and the new person is the one with the next free id
function createPersonFromPending(pendingPerson) {
	return createPersonRecord(pendingPerson)
}

// Until the relations dialog is saved a person who does not exist yet is only { isNew, firstName, lastName, gender, birth, death, isDeceased } on an entry or on its other parent, so nothing is left behind when a dialog is cancelled, saving makes a page for each of them and puts { personId } in their place, the same name written twice in one save is one new person, made from the first one that was found, and the ids of the new people are answered so they take part in the inference
function materializePendingPeople() {
	let createdIds = new Map()
	let getCreatedId = (pendingPerson) => {
		let key = normalizeNameText(getPendingPersonName(pendingPerson))

		if(!createdIds.has(key)){
			createdIds.set(key, createPersonFromPending(pendingPerson))
		}

		return createdIds.get(key)
	}

	for(let role of relationRoles){
		for(let entry of relationsDraft.entries[role]){
			if(entry.isNew){
				entry.personId = getCreatedId(entry)

				for(let key of [`isNew`, `firstName`, `lastName`, `gender`, `birth`, `death`, `isDeceased`]){
					delete entry[key]
				}
			}

			if(entry.coParent?.isNew){
				entry.coParent = { personId : getCreatedId(entry.coParent) }
			}
		}
	}

	return [...createdIds.values()]
}

// The typed sources are written to the person and mirrored on the other side, the ones that were taken out are taken out of the other side first so a person who changes role is not left linked twice, the lists then take the dialog's copy, which still holds the sources the page worked out, and what can be worked out is worked out for the person and everyone who was touched, then viewPerson redraws the page and saves, a link that the page had worked out and that the dialog took away is recorded on both sides, so the page does not work it out again, and a person who was added by hand in the dialog is taken off that record again, a typed source whose kind of link matches a source that the page worked out on its own absorbs it before anything is worked out again
function saveRelations(event) {
	event.preventDefault()
	syncRelationsFromForm()

	let activeId = activeHistory.at(-1)
	let person = persons[activeId]

	if(!person){
		return
	}

	let touchedIds = new Set([activeId, ...materializePendingPeople()])
	let removedInferences = []

	for(let role of relationRoles){
		for(let existingEntry of person.relations?.[role] ?? []){
			if(existingEntry.personId == null){
				continue
			}

			touchedIds.add(existingEntry.personId)

			let draftEntry = relationsDraft.entries[role].find((entry) => entry.personId === existingEntry.personId)

			if(getManualVariants(existingEntry).length > 0 && (!draftEntry || getManualVariants(draftEntry).length == 0)){
				removeReciprocalRelation(activeId, role, existingEntry.personId)
			}

			if(getUnquestionedInferences(existingEntry).length > (draftEntry ? getUnquestionedInferences(draftEntry).length : 0)){
				removedInferences.push({
					role : role,
					targetId : existingEntry.personId
				})
			}
		}
	}

	for(let role of relationRoles){
		ensureRelations(person)[role] = relationsDraft.entries[role].map((entry) => {
			let { coParent, originalCoParent, ...savedEntry } = JSON.parse(JSON.stringify(entry))

			return savedEntry
		})
	}

	for(let role of relationRoles){
		for(let entry of person.relations[role]){
			absorbDuplicateInferences(entry)
		}
	}

	for(let role of relationRoles){
		for(let entry of person.relations[role]){
			if(entry.personId != null){
				touchedIds.add(entry.personId)

				syncReciprocalRelation(activeId, role, entry.personId)
			}
		}
	}

	for(let entry of relationsDraft.entries.children){
		if(entry.personId != null){
			applyChildCoParent(entry, activeId, touchedIds)
		}
	}

	for(let removedInference of removedInferences){
		let reciprocalRole = getReciprocalRole(removedInference.role)
		let target = persons[removedInference.targetId]
		let reciprocalEntry = target ? findRelationEntry(target, reciprocalRole, activeId) : null

		blockInference(person, removedInference.role, removedInference.targetId)

		if(reciprocalEntry && reciprocalEntry.variants.some((variant) => variant.isAutoInferred)){
			blockInference(target, reciprocalRole, activeId)
		}
	}

	for(let key of relationsDraft.addedKeys){
		let [role, targetText] = key.split(`:`)
		let targetId = Number(targetText)
		let draftEntry = relationsDraft.entries[role]?.find((entry) => entry.personId === targetId)

		if(draftEntry && getManualVariants(draftEntry).length > 0){
			unblockInference(person, role, targetId)

			if(persons[targetId]){
				unblockInference(persons[targetId], getReciprocalRole(role), activeId)
			}
		}
	}

	cleanupRelations(person)
	rebuildPlainTextRelationIndex()

	for(let touchedId of touchedIds){
		runRelationInference(touchedId)
	}

	closeRelations()
	viewPerson()
}

// The page starts here, once this file has been read, because the first drawing of a person needs the relations, what scripts.js holds is the function that does it
startApp()