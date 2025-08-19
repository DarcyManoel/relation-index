let persons=[]
function renderPersons(){
	document.getElementById(`navigation`).innerHTML=`<span onclick="renderPersons()">persons</span>`
	//	recursive renderer
	function renderRecursive(key,value){
		if(Array.isArray(value)){
			//	arrays
			if(value.every(v=>typeof v!==`object`)){
				//	primative arrays
				if(typeof value[0]===`number`){
					return`
						<details>
							<summary>${capitaliseFirstLetter(key)}</summary>
							${value.map(value=>`<div><span href="#p${value}" onclick="document.getElementById(\`p${value}\`).setAttribute(\`open\`,\`\`)">${persons[value].name.given.join(`-`)} ${persons[value].name.family.join(`-`)}</span></div>`).join(``)}
						</details>`
				}else{
					return`
						<details>
							<summary>${capitaliseFirstLetter(key)}</summary>
							${value.map(value=>`<div>${value}</div>`).join(``)}
						</details>`
				}
			}else{
				//	object arrays
				if(Object.keys(value[0]).includes(`type`)){
					return`
						<details>
							<summary>${capitaliseFirstLetter(key)}</summary>
							${value
								.sort((a,b)=>
									a.date.year-b.date.year||
									a.date.month-b.date.month||
									a.date.day-b.date.day)
								.map(element=>renderRecursive(`${element.type} (${element.date.year})`,element)).join(``)}
						</details>`
				}else{
					return`
						<details>
							<summary>${capitaliseFirstLetter(key)}</summary>
							${value.map((element,index)=>renderRecursive(`${index+1}`,element)).join(``)}
						</details>`
				}
			}
		}else if(typeof value===`object`&&value!==null){
			//	objects
			return`
				<details>
					<summary>${capitaliseFirstLetter(key)}</summary>
					${Object.entries(value)
						.map(([childKey,childValue])=>renderRecursive(childKey,childValue))
						.join(``)}
				</details>`
		}else{
			//	primitives
			if(key===`day`){
				return`<div><strong>${capitaliseFirstLetter(key)}: </strong>${value}</div>`
			}if(key===`month`){
				return`<div><strong>${capitaliseFirstLetter(key)}: </strong>${value} (${monthNames[value-1]})</div>`
			}else{
				return`<div><strong>${capitaliseFirstLetter(key)}: </strong>${value}</div>`
			}
		}
	}
	document.getElementById(`content`).innerHTML=persons.map((person,index)=>`
		<details id="p${index}">
			<summary>${person.name.given.join(`-`)} ${person.name.family.join(`-`)}</summary>
			${Object.entries(person).map(([key,value])=>renderRecursive(key,value)).join(``)}
		</details>
	`).join(``)
}
function importData(){
	let fileInput=document.createElement(`input`)
	fileInput.type=`file`
	fileInput.accept=`.json`
	fileInput.style.display=`none`
	fileInput.onchange=(e)=>{
		let reader=new FileReader()
		reader.onload=()=>{
			console.log(persons=JSON.parse(reader.result))
			renderPersons()
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
renderPersons()
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

persons=[{"name":{"given":["Darcy"],"family":["Hamilton","Manoel"]},"events":[{"date":{"day":9,"month":5,"year":2000},"type":"birth","location":"Modbury Public Hospital, Modbury, South Australia"}],"relations":{"parents":[2,3],"siblings":[1]}},{"name":{"given":["Monty"],"family":["Manoel"]},"events":[{"date":{"day":2,"month":5,"year":1999},"type":"birth","location":"Adelaide, South Australia"}],"relations":{"parents":[2,3],"siblings":[0]}},{"name":{"given":["Richard","John"],"family":["Manoel"]},"events":[{"date":{"day":25,"month":6,"year":1967},"type":"birth","location":"North Adelaide, South Australia"}],"relations":{"parents":[4,5],"children":[0,1],"siblings":[6]}},{"name":{"given":["Brandi"],"family":["Hamilton"]},"relations":{"children":[1,0]}},{"name":{"given":["Raymond"],"family":["Manoel"]},"events":[{"date":{"day":22,"month":6,"year":1933},"type":"birth"},{"date":{"day":10,"month":9,"year":2016},"type":"death"}],"relations":{"children":[2,6]}},{"name":{"given":["Gwendoline"],"family":["Lepoidevin"]},"relations":{"children":[2,6]}},{"name":{"given":["Wendy","Joy"],"family":["Manoel"]},"relations":{"parents":[4,5],"siblings":[2]}}]
renderPersons()