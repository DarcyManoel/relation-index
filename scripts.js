let persons=[]
function createPerson(){
	persons.push({
		name:{
			given:[`Person`],
			family:[persons.length+1]
		},
		lifespan:{
			birth:null,
			death:null
		},
		relations:{
			parents:[],
			siblings:[],
			children:[]
		}
	})
	selectPerson(persons.length-1)
}
let relationDisplayOrder=[
	`parents`,
	`siblings`,
	`children`
]
function selectPerson(id){
	selectedPersonId=id
	renderPerson()
}
function renderPerson(){
	let person=persons[selectedPersonId]
	let{alias,given,family}=person.name
	let{birth,death}=person.lifespan
	document.getElementById(`banner`).innerHTML=renderBanner()
	let relations=person.relations
	document.getElementById(`relations`).innerHTML=relationDisplayOrder.map(
		relationType=>!relations?.[relationType]?.length?``:`
			<div class="details" open id="${relationType}">
				<div class="summary" onclick="this.parentElement.toggleAttribute('open')">${capitaliseFirstLetter(relationType)}<div class="summary-action" tooltip="Add Relation" onclick="event.stopPropagation();editRelations('${relationType}')">&#65291;</div></div>
				<div class="content">
				${relations[relationType]
					.sort((a,b)=>(persons[a]?.lifespan.birth)-(persons[b]?.lifespan.birth))
					.map(relation=>renderBanner(relation,1)).join(``)}
				</div>
			</div>`).join(``)
}
function renderBanner(index=selectedPersonId,allowOnclick){
	if(+index!==index)return
	let onclick=allowOnclick
		?`onclick="selectPerson(${index})"`
		:``
	let person=persons[index]
	let{alias,given,family}=person.name
	let{birth,death}=person.lifespan
	return`
		<div ${onclick} class="banner">
			<div>${given[0]} ${family.join(`-`)} <span class="inline-container">${(alias||[]).map(a=>`<div hidden="until-found">'${a}'</div>`).join(``)}</span></div>
			<div class="lifespan">${birth||``} - ${death||``}</div>
		</div>`
}
function inferRelations(){
	for(let personIndex in persons){
		let person=persons[personIndex]
		//	siblings
		let siblings=(person.relations.siblings??=[])
		for(let parentIndex of person.relations.parents){
			if(+parentIndex!==parentIndex)continue
			let parent=persons[parentIndex]
			for(let childIndex of parent.relations.children){
				if(childIndex===+personIndex)continue
				if(siblings.includes(childIndex))continue
				siblings.push(childIndex)
			}
		}
	}
	renderPerson()
}
function hideModal(){
	document.getElementById(`modal`).innerHTML=``
}
let originalRelations=[] // an array to store a copy of the person's relations before editing
function editRelations(relationType){
	originalRelations=[...persons[selectedPersonId].relations[relationType]] // clone current relations to allow later reversion
	document.getElementById(`modal`).innerHTML=`
		<div class="title">${capitaliseFirstLetter(relationType)}</div>
		<div id="persons" childCount="${persons.length-1}">
			${persons
				.map((key,index)=>index===selectedPersonId?``
					:`<div id="p${index}" onclick="toggleRelation(+this.id.slice(1),'${relationType}')">${renderBanner(index)}</div>`).join(``)}
		</div>
		<div class="buttons">
			<div class="revert" onclick="revertChanges('${relationType}')">Revert</div>
			<div class="save" onclick="hideModal()">Save Changes</div>
		</div>
	` // inject modal markup with title, person list, and action buttons
	highlightModalRelations(relationType) // visually highlight current relations
}
function highlightModalRelations(relationType){
	for(person of document.getElementById(`persons`).children){
		document.getElementById(person.id).classList.remove(`related`) // clear any existing highlight
		if(persons[selectedPersonId].relations[relationType].includes(+person.id.slice(1))){
			document.getElementById(person.id).classList.add(`related`)
		} // check if this person is related to the selected person under the given type and apply highlight if relation exists
	}
}
let nonreciprocalRelationLinks={
	parents:`children`,
	children:`parents`
} // map relation types that are not reciprocal
function toggleRelation(personId,relationType){
	let targetLink=nonreciprocalRelationLinks[relationType]||relationType // decide which relation type to update on the target person
	let selectedRelations=persons[selectedPersonId].relations[relationType] // array of selected person's relations for this type
	let targetRelations=persons[personId].relations[targetLink] // array of the target person's relations for corresponding type
	if(selectedRelations.includes(personId)){
		persons[selectedPersonId].relations[relationType]=selectedRelations.filter(relation=>relation!==personId) // remove target person from selected person
		persons[personId].relations[targetLink]=targetRelations.filter(relation=>relation!==selectedPersonId) // remove selected person from target person
	} // relation exists, remove it
	else{
		selectedRelations.push(personId) // add target person to selected person
		targetRelations.push(selectedPersonId) // add selected person to target person
	} // relation missing, add it
	highlightModalRelations(relationType) // refresh person highlights in modal
	renderPerson() // re-render person display to reflect changes
}
function revertChanges(relationType){
	persons[selectedPersonId].relations[relationType]=originalRelations // revert changes made to the selected relations by restoring to the state before edits were made
	renderPerson() // re-render person display to reflect the reversion
	hideModal()
}
function importData(){
	let fileInput=document.createElement(`input`)
	fileInput.type=`file`
	fileInput.accept=`.json`
	fileInput.style.display=`none`
	fileInput.onchange=(e)=>{
		let reader=new FileReader()
		reader.onload=()=>{
			selectedPersonId=0
			console.log(persons=JSON.parse(reader.result))
			inferRelations()
		}
		reader.readAsText(e.target.files[0])
		document.body.removeChild(fileInput)
	}
	fileInput.oncancel=()=>{
		document.body.removeChild(fileInput)
	}
	document.body.appendChild(fileInput)
	fileInput.click()
}
function exportData(){
	let date=new Date().toISOString().split('T')[0]
	let file=new Blob([JSON.stringify(persons)],{type:`application/json`})
	let link=document.createElement(`a`)
	link.href=URL.createObjectURL(file)
	link.download=`relation-index.json`
	link.click()
	URL.revokeObjectURL(link.href)
}
//	tools
function appendOrdinal(int){
	return int+((int%100>10&&int%100<14)
		?`th`
		:[`th`,`st`,`nd`,`rd`][int%10]||`th`)
}
function capitaliseFirstLetter(str){
	return String(str).charAt(0).toUpperCase()+String(str).slice(1)
}
let monthNames=[
	`January`,
	`February`,
	`March`,
	`April`,
	`May`,
	`June`,
	`July`,
	`August`,
	`September`,
	`October`,
	`November`,
	`December`
]
//	initialisation
let selectedPersonId=0
createPerson()