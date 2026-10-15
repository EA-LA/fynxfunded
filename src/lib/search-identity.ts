export function searchIdentity(url: string, title: string, description: string) {
  const org = 'https://www.fynxfinanceworld.com/#organization';
  const site = 'https://www.fynxfunded.com/';
  return {'@context':'https://schema.org','@graph':[
    {'@type':'Organization','@id':org,name:'FYNX',url:'https://www.fynxfinanceworld.com/',founder:{'@id':'https://elhamamini.cc/#person'}},
    {'@type':'Person','@id':'https://elhamamini.cc/#person',name:'Elham Amini',url:'https://elhamamini.cc/',sameAs:['https://www.linkedin.com/in/elham-amini-745560302/','https://www.instagram.com/___elham_amini___/']},
    {'@type':'WebSite','@id':site+'#website',name:'FYNX Funded',url:site,publisher:{'@id':org}},
    {'@type':'WebPage','@id':url+'#webpage',url,name:title,description,isPartOf:{'@id':site+'#website'},publisher:{'@id':org}},
    ...(url!==site?[{'@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'FYNX Funded',item:site},{'@type':'ListItem',position:2,name:title.replace(' | FYNX Funded',''),item:url}]}]:[])
  ]};
}
