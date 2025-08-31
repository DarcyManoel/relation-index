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
let relationDisplayOrder=[
	`parents`,
	`children`,
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
			<details open id="${relationType}">
				<summary>${capitaliseFirstLetter(relationType)}</summary>
				${relations[relationType]
					.sort((a,b)=>(+b===b)-(+a===a))
					.map(relation=>{
						let isIndex=+relation===relation
						return isIndex
							?renderBanner(relation)
							:`<div>${relation}</div>`})
					.join(``)}
			</details>`).join(``)
}
function renderBanner(index=selectedPersonId){
	let person=persons[index]
	let{alias,given,family}=person.name
	let{birth,death}=person.lifespan
	return`
		<div onclick="selectPerson(${index})">
			<div>${given[0]} ${family.join(`-`)} <span class="inline-container">${(alias||[]).map(a=>`<div hidden="until-found">'${a}'</div>`).join(``)}</span></div>
			<div class="lifespan">${birth||``} - ${death||``}</div>
		</div>`
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