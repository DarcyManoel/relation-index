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
		}
	})
	selectPerson(persons.length-1)
}
let relationLinks={
	children:`parents`,
	parents:`children`,
	siblings:`siblings`
}
let relationDisplayOrder=[
	`parents`,
	`siblings`,
	`children`,
]
function selectPerson(id){
	selectedPersonId=id
	renderPerson()
}
function renderPerson(){
	let person=persons[selectedPersonId]
	let{birth,death}=person.lifespan
	//	banner
	document.getElementById(`banner`).innerHTML=`
		<div id="name">${persons[selectedPersonId].name.given[0]} ${persons[selectedPersonId].name.family.join(`-`)}</div>
		<div class="lifespan">${birth||``} - ${death||``}</div>`
	//	relations
	let relations=person.relations
	document.getElementById(`relations`).innerHTML=relationDisplayOrder.map(
		relationType=>!relations?.[relationType]?.length?``:`
			<details open id="${relationType}">
				<summary>${capitaliseFirstLetter(relationType)}</summary>
				${relations[relationType].map(renderRelation).join(``)}
			</details>`).join(``)
}
function renderRelation(relation){
	if(typeof relation===`number`){
		let person=persons[relation]
		let fullName=Object.values(person.name)
			.map(nameType=>nameType.join(`-`))
			.join(` `)
		let lifespan=`${person.lifespan.birth||``} - ${person.lifespan.death||``}`
		return`
			<div onclick="selectPerson(${relation})">
				${fullName}
				<div class="lifespan">${lifespan}</div>
			</div>`
	}else{
		return`<div>${relation}</div>`
	}
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
			renderPerson()
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