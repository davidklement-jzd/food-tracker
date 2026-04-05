// Česká databáze potravin – nutriční hodnoty na 100g
// Zdroj: Standardní nutriční tabulky

const czechFoods = [
  // === MASO ===
  { id: 'cz-kureci-prsa', name: 'Kuřecí prsa', category: 'Maso', kcal: 165, protein: 31, carbs: 0, fat: 3.6, serving: null },
  { id: 'cz-kureci-stehno', name: 'Kuřecí stehno', category: 'Maso', kcal: 177, protein: 24.2, carbs: 0, fat: 8.4, serving: null },
  { id: 'cz-veprove-kotleta', name: 'Vepřová kotleta', category: 'Maso', kcal: 242, protein: 27, carbs: 0, fat: 14, serving: '150g' },
  { id: 'cz-veprove-rameno', name: 'Vepřové rameno', category: 'Maso', kcal: 236, protein: 17, carbs: 0, fat: 18, serving: null },
  { id: 'cz-hovezi-svickova', name: 'Hovězí svíčková (maso)', category: 'Maso', kcal: 218, protein: 26, carbs: 0, fat: 12, serving: null },
  { id: 'cz-hovezi-mlete', name: 'Hovězí mleté maso', category: 'Maso', kcal: 254, protein: 17.2, carbs: 0, fat: 20, serving: null },
  { id: 'cz-kruti-prsa', name: 'Krůtí prsa', category: 'Maso', kcal: 135, protein: 30, carbs: 0, fat: 1.5, serving: null },
  { id: 'cz-slanina', name: 'Slanina', category: 'Maso', kcal: 458, protein: 12, carbs: 0, fat: 45, serving: '20g' },
  { id: 'cz-sunka', name: 'Šunka vepřová', category: 'Maso', kcal: 115, protein: 18, carbs: 1.5, fat: 4, serving: '30g' },
  { id: 'cz-klobasa', name: 'Klobása', category: 'Maso', kcal: 280, protein: 12, carbs: 2, fat: 25, serving: '100g' },
  { id: 'cz-parek', name: 'Párek', category: 'Maso', kcal: 230, protein: 11, carbs: 2, fat: 20, serving: '50g' },
  { id: 'cz-salami', name: 'Salám trvanlivý', category: 'Maso', kcal: 380, protein: 18, carbs: 1, fat: 34, serving: '30g' },

  // === RYBY ===
  { id: 'cz-losos', name: 'Losos', category: 'Ryby', kcal: 208, protein: 20, carbs: 0, fat: 13, serving: '125g' },
  { id: 'cz-tunак', name: 'Tuňák v konzervě (ve vlastní šťávě)', category: 'Ryby', kcal: 116, protein: 26, carbs: 0, fat: 1, serving: '80g' },
  { id: 'cz-treska', name: 'Treska', category: 'Ryby', kcal: 82, protein: 18, carbs: 0, fat: 0.7, serving: '125g' },
  { id: 'cz-kapr', name: 'Kapr', category: 'Ryby', kcal: 127, protein: 18, carbs: 0, fat: 5.6, serving: '150g' },

  // === MLÉČNÉ VÝROBKY ===
  { id: 'cz-mleko-polotucne', name: 'Mléko polotučné 1.5%', category: 'Mléčné výrobky', kcal: 47, protein: 3.3, carbs: 4.8, fat: 1.5, serving: '250ml' },
  { id: 'cz-mleko-plnotucne', name: 'Mléko plnotučné 3.5%', category: 'Mléčné výrobky', kcal: 64, protein: 3.3, carbs: 4.7, fat: 3.5, serving: '250ml' },
  { id: 'cz-jogurt-bily', name: 'Jogurt bílý', category: 'Mléčné výrobky', kcal: 63, protein: 3.5, carbs: 4.7, fat: 3.3, serving: '150g' },
  { id: 'cz-jogurt-recky', name: 'Řecký jogurt', category: 'Mléčné výrobky', kcal: 97, protein: 9, carbs: 3.6, fat: 5, serving: '150g' },
  { id: 'cz-tvaroh-polotucny', name: 'Tvaroh polotučný', category: 'Mléčné výrobky', kcal: 105, protein: 13, carbs: 3.5, fat: 4.5, serving: '250g' },
  { id: 'cz-tvaroh-tučný', name: 'Tvaroh tučný', category: 'Mléčné výrobky', kcal: 155, protein: 11, carbs: 3, fat: 11, serving: '250g' },
  { id: 'cz-cottage', name: 'Cottage cheese', category: 'Mléčné výrobky', kcal: 98, protein: 12, carbs: 3.4, fat: 4.3, serving: '150g' },
  { id: 'cz-eidam-30', name: 'Eidam 30%', category: 'Mléčné výrobky', kcal: 263, protein: 27, carbs: 0.5, fat: 17, serving: '30g' },
  { id: 'cz-eidam-45', name: 'Eidam 45%', category: 'Mléčné výrobky', kcal: 340, protein: 25, carbs: 0.5, fat: 27, serving: '30g' },
  { id: 'cz-mascarpone', name: 'Mascarpone', category: 'Mléčné výrobky', kcal: 429, protein: 4.6, carbs: 3, fat: 44, serving: '30g' },
  { id: 'cz-smetana-ke-slehani', name: 'Smetana ke šlehání 33%', category: 'Mléčné výrobky', kcal: 308, protein: 2.2, carbs: 3.2, fat: 33, serving: '30ml' },
  { id: 'cz-smetana-na-vareni', name: 'Smetana na vaření 12%', category: 'Mléčné výrobky', kcal: 131, protein: 3, carbs: 4, fat: 12, serving: '100ml' },
  { id: 'cz-maslo', name: 'Máslo', category: 'Mléčné výrobky', kcal: 717, protein: 0.9, carbs: 0.1, fat: 81, serving: '10g' },

  // === VEJCE ===
  { id: 'cz-vejce', name: 'Vejce slepičí', category: 'Vejce', kcal: 155, protein: 13, carbs: 1.1, fat: 11, serving: '60g' },
  { id: 'cz-vejce-bilek', name: 'Vaječný bílek', category: 'Vejce', kcal: 52, protein: 11, carbs: 0.7, fat: 0.2, serving: '33g' },

  // === PEČIVO A CEREÁLIE ===
  { id: 'cz-chleb-zitny', name: 'Chléb žitný', category: 'Pečivo', kcal: 230, protein: 6, carbs: 46, fat: 1.2, serving: '60g' },
  { id: 'cz-chleb-celozrnny', name: 'Chléb celozrnný', category: 'Pečivo', kcal: 210, protein: 8, carbs: 40, fat: 2, serving: '60g' },
  { id: 'cz-rohlik', name: 'Rohlík', category: 'Pečivo', kcal: 280, protein: 8.5, carbs: 54, fat: 3, serving: '43g' },
  { id: 'cz-houska', name: 'Houska', category: 'Pečivo', kcal: 275, protein: 8, carbs: 53, fat: 2.5, serving: '55g' },
  { id: 'cz-knedlik-houskovy', name: 'Knedlík houskový', category: 'Pečivo', kcal: 210, protein: 6.5, carbs: 43, fat: 1, serving: '100g' },
  { id: 'cz-knedlik-bramborovy', name: 'Knedlík bramborový', category: 'Pečivo', kcal: 170, protein: 3.5, carbs: 36, fat: 0.8, serving: '100g' },
  { id: 'cz-ovesne-vlocky', name: 'Ovesné vločky', category: 'Cereálie', kcal: 372, protein: 13, carbs: 60, fat: 7, serving: '50g' },
  { id: 'cz-musli', name: 'Müsli', category: 'Cereálie', kcal: 380, protein: 9, carbs: 64, fat: 8, serving: '50g' },
  { id: 'cz-corn-flakes', name: 'Corn flakes', category: 'Cereálie', kcal: 357, protein: 7, carbs: 84, fat: 0.9, serving: '30g' },

  // === PŘÍLOHY ===
  { id: 'cz-ryze-bila', name: 'Rýže bílá (vařená)', category: 'Přílohy', kcal: 130, protein: 2.7, carbs: 28, fat: 0.3, serving: '150g' },
  { id: 'cz-ryze-natural', name: 'Rýže natural (vařená)', category: 'Přílohy', kcal: 123, protein: 2.7, carbs: 25.6, fat: 1, serving: '150g' },
  { id: 'cz-testoviny-varene', name: 'Těstoviny (vařené)', category: 'Přílohy', kcal: 131, protein: 5, carbs: 25, fat: 1.1, serving: '200g' },
  { id: 'cz-brambory', name: 'Brambory vařené', category: 'Přílohy', kcal: 77, protein: 2, carbs: 17, fat: 0.1, serving: '200g' },
  { id: 'cz-bramborova-kase', name: 'Bramborová kaše', category: 'Přílohy', kcal: 106, protein: 2, carbs: 16, fat: 4, serving: '200g' },
  { id: 'cz-hranolky', name: 'Hranolky', category: 'Přílohy', kcal: 312, protein: 3.4, carbs: 41, fat: 15, serving: '150g' },
  { id: 'cz-kuskus', name: 'Kuskus (vařený)', category: 'Přílohy', kcal: 112, protein: 3.8, carbs: 23, fat: 0.2, serving: '150g' },
  { id: 'cz-bulgur', name: 'Bulgur (vařený)', category: 'Přílohy', kcal: 83, protein: 3.1, carbs: 18.6, fat: 0.2, serving: '150g' },

  // === LUŠTĚNINY ===
  { id: 'cz-cocka', name: 'Čočka (vařená)', category: 'Luštěniny', kcal: 116, protein: 9, carbs: 20, fat: 0.4, serving: '150g' },
  { id: 'cz-fazole', name: 'Fazole (vařené)', category: 'Luštěniny', kcal: 127, protein: 8.7, carbs: 22, fat: 0.5, serving: '150g' },
  { id: 'cz-cizrna', name: 'Cizrna (vařená)', category: 'Luštěniny', kcal: 164, protein: 8.9, carbs: 27, fat: 2.6, serving: '150g' },

  // === OVOCE ===
  { id: 'cz-jablko', name: 'Jablko', category: 'Ovoce', kcal: 52, protein: 0.3, carbs: 14, fat: 0.2, serving: '150g' },
  { id: 'cz-banan', name: 'Banán', category: 'Ovoce', kcal: 89, protein: 1.1, carbs: 23, fat: 0.3, serving: '120g' },
  { id: 'cz-pomeranc', name: 'Pomeranč', category: 'Ovoce', kcal: 47, protein: 0.9, carbs: 12, fat: 0.1, serving: '150g' },
  { id: 'cz-hruska', name: 'Hruška', category: 'Ovoce', kcal: 57, protein: 0.4, carbs: 15, fat: 0.1, serving: '150g' },
  { id: 'cz-jahody', name: 'Jahody', category: 'Ovoce', kcal: 33, protein: 0.7, carbs: 8, fat: 0.3, serving: '150g' },
  { id: 'cz-boruvky', name: 'Borůvky', category: 'Ovoce', kcal: 57, protein: 0.7, carbs: 14, fat: 0.3, serving: '100g' },
  { id: 'cz-maliny', name: 'Maliny', category: 'Ovoce', kcal: 52, protein: 1.2, carbs: 12, fat: 0.7, serving: '100g' },
  { id: 'cz-hrozny', name: 'Hroznové víno', category: 'Ovoce', kcal: 69, protein: 0.7, carbs: 18, fat: 0.2, serving: '100g' },
  { id: 'cz-kiwi', name: 'Kiwi', category: 'Ovoce', kcal: 61, protein: 1.1, carbs: 15, fat: 0.5, serving: '75g' },
  { id: 'cz-mandarinka', name: 'Mandarinka', category: 'Ovoce', kcal: 53, protein: 0.8, carbs: 13, fat: 0.3, serving: '80g' },
  { id: 'cz-avokado', name: 'Avokádo', category: 'Ovoce', kcal: 160, protein: 2, carbs: 8.5, fat: 15, serving: '80g' },

  // === ZELENINA ===
  { id: 'cz-rajce', name: 'Rajče', category: 'Zelenina', kcal: 18, protein: 0.9, carbs: 3.9, fat: 0.2, serving: '120g' },
  { id: 'cz-okurka', name: 'Okurka salátová', category: 'Zelenina', kcal: 15, protein: 0.7, carbs: 3.6, fat: 0.1, serving: '200g' },
  { id: 'cz-paprika', name: 'Paprika', category: 'Zelenina', kcal: 31, protein: 1, carbs: 6, fat: 0.3, serving: '150g' },
  { id: 'cz-mrkev', name: 'Mrkev', category: 'Zelenina', kcal: 41, protein: 0.9, carbs: 10, fat: 0.2, serving: '80g' },
  { id: 'cz-cibule', name: 'Cibule', category: 'Zelenina', kcal: 40, protein: 1.1, carbs: 9, fat: 0.1, serving: '80g' },
  { id: 'cz-cesnek', name: 'Česnek', category: 'Zelenina', kcal: 149, protein: 6.4, carbs: 33, fat: 0.5, serving: '5g' },
  { id: 'cz-brokolice', name: 'Brokolice', category: 'Zelenina', kcal: 34, protein: 2.8, carbs: 7, fat: 0.4, serving: '150g' },
  { id: 'cz-špenát', name: 'Špenát', category: 'Zelenina', kcal: 23, protein: 2.9, carbs: 3.6, fat: 0.4, serving: '150g' },
  { id: 'cz-cuketa', name: 'Cuketa', category: 'Zelenina', kcal: 17, protein: 1.2, carbs: 3.1, fat: 0.3, serving: '200g' },
  { id: 'cz-zelí', name: 'Zelí bílé', category: 'Zelenina', kcal: 25, protein: 1.3, carbs: 6, fat: 0.1, serving: '150g' },
  { id: 'cz-salat-ledovy', name: 'Salát ledový', category: 'Zelenina', kcal: 14, protein: 0.9, carbs: 3, fat: 0.1, serving: '100g' },
  { id: 'cz-kukurice', name: 'Kukuřice (konzervovaná)', category: 'Zelenina', kcal: 82, protein: 2.4, carbs: 16, fat: 1.2, serving: '100g' },
  { id: 'cz-hrasek', name: 'Hrášek (konzervovaný)', category: 'Zelenina', kcal: 69, protein: 4.4, carbs: 12, fat: 0.4, serving: '100g' },

  // === TUKY A OLEJE ===
  { id: 'cz-olivovy-olej', name: 'Olivový olej', category: 'Tuky', kcal: 884, protein: 0, carbs: 0, fat: 100, serving: '10ml' },
  { id: 'cz-slunecnicovy-olej', name: 'Slunečnicový olej', category: 'Tuky', kcal: 884, protein: 0, carbs: 0, fat: 100, serving: '10ml' },
  { id: 'cz-kokosovy-olej', name: 'Kokosový olej', category: 'Tuky', kcal: 862, protein: 0, carbs: 0, fat: 100, serving: '10ml' },

  // === OŘECHY A SEMÍNKA ===
  { id: 'cz-vlasske-orechy', name: 'Vlašské ořechy', category: 'Ořechy', kcal: 654, protein: 15, carbs: 14, fat: 65, serving: '30g' },
  { id: 'cz-mandle', name: 'Mandle', category: 'Ořechy', kcal: 579, protein: 21, carbs: 22, fat: 50, serving: '30g' },
  { id: 'cz-arasidy', name: 'Arašídy', category: 'Ořechy', kcal: 567, protein: 26, carbs: 16, fat: 49, serving: '30g' },
  { id: 'cz-arasidove-maslo', name: 'Arašídové máslo', category: 'Ořechy', kcal: 588, protein: 25, carbs: 20, fat: 50, serving: '15g' },
  { id: 'cz-slunecnicova-seminka', name: 'Slunečnicová semínka', category: 'Ořechy', kcal: 584, protein: 21, carbs: 20, fat: 51, serving: '20g' },
  { id: 'cz-chia-seminky', name: 'Chia semínka', category: 'Ořechy', kcal: 486, protein: 17, carbs: 42, fat: 31, serving: '15g' },
  { id: 'cz-lnena-seminky', name: 'Lněná semínka', category: 'Ořechy', kcal: 534, protein: 18, carbs: 29, fat: 42, serving: '15g' },

  // === SLADKÉ ===
  { id: 'cz-med', name: 'Med', category: 'Sladké', kcal: 304, protein: 0.3, carbs: 82, fat: 0, serving: '15g' },
  { id: 'cz-cukr', name: 'Cukr', category: 'Sladké', kcal: 387, protein: 0, carbs: 100, fat: 0, serving: '5g' },
  { id: 'cz-cokolada-mlecna', name: 'Čokoláda mléčná', category: 'Sladké', kcal: 535, protein: 7.6, carbs: 59, fat: 30, serving: '25g' },
  { id: 'cz-cokolada-horka', name: 'Čokoláda hořká 70%', category: 'Sladké', kcal: 598, protein: 7.8, carbs: 46, fat: 43, serving: '25g' },
  { id: 'cz-dzemem', name: 'Džem', category: 'Sladké', kcal: 250, protein: 0.5, carbs: 60, fat: 0.1, serving: '20g' },

  // === NÁPOJE ===
  { id: 'cz-pivo', name: 'Pivo 10°', category: 'Nápoje', kcal: 40, protein: 0.3, carbs: 3.5, fat: 0, serving: '500ml' },
  { id: 'cz-pivo-12', name: 'Pivo 12°', category: 'Nápoje', kcal: 48, protein: 0.4, carbs: 4, fat: 0, serving: '500ml' },
  { id: 'cz-vino-bile', name: 'Víno bílé', category: 'Nápoje', kcal: 82, protein: 0.1, carbs: 2.6, fat: 0, serving: '200ml' },
  { id: 'cz-vino-cervene', name: 'Víno červené', category: 'Nápoje', kcal: 85, protein: 0.1, carbs: 2.6, fat: 0, serving: '200ml' },
  { id: 'cz-coca-cola', name: 'Coca-Cola', category: 'Nápoje', kcal: 42, protein: 0, carbs: 10.6, fat: 0, serving: '330ml' },
  { id: 'cz-dzus-pomerancovy', name: 'Džus pomerančový', category: 'Nápoje', kcal: 45, protein: 0.7, carbs: 10, fat: 0.2, serving: '250ml' },

  // === ČESKÁ JÍDLA (hotová) ===
  { id: 'cz-svickova', name: 'Svíčková na smetaně (omáčka)', category: 'Česká jídla', kcal: 95, protein: 3, carbs: 10, fat: 5, serving: '200g' },
  { id: 'cz-gulas', name: 'Guláš hovězí', category: 'Česká jídla', kcal: 110, protein: 10, carbs: 5, fat: 5.5, serving: '250g' },
  { id: 'cz-rizek-smazeny', name: 'Řízek smažený (vepřový)', category: 'Česká jídla', kcal: 260, protein: 18, carbs: 14, fat: 15, serving: '150g' },
  { id: 'cz-bramborak', name: 'Bramborák', category: 'Česká jídla', kcal: 200, protein: 4, carbs: 24, fat: 10, serving: '120g' },
  { id: 'cz-polevka-cesnekova', name: 'Polévka česneková', category: 'Česká jídla', kcal: 55, protein: 2, carbs: 7, fat: 2, serving: '300ml' },
  { id: 'cz-polevka-kulajda', name: 'Kulajda', category: 'Česká jídla', kcal: 80, protein: 3, carbs: 8, fat: 4, serving: '300ml' },
  { id: 'cz-polevka-bramboracka', name: 'Bramboračka', category: 'Česká jídla', kcal: 60, protein: 2.5, carbs: 8, fat: 2, serving: '300ml' },
  { id: 'cz-smazeny-syr', name: 'Smažený sýr', category: 'Česká jídla', kcal: 330, protein: 16, carbs: 15, fat: 23, serving: '120g' },
  { id: 'cz-palacinka', name: 'Palačinka', category: 'Česká jídla', kcal: 190, protein: 6, carbs: 27, fat: 6.5, serving: '80g' },
  { id: 'cz-buchty', name: 'Buchty na páře', category: 'Česká jídla', kcal: 245, protein: 6, carbs: 42, fat: 5.5, serving: '80g' },
  { id: 'cz-ovocne-knedliky', name: 'Ovocné knedlíky', category: 'Česká jídla', kcal: 180, protein: 4, carbs: 35, fat: 2, serving: '200g' },

  // === OSTATNÍ ===
  { id: 'cz-ryze-sucha', name: 'Rýže (suchá)', category: 'Přílohy', kcal: 350, protein: 7, carbs: 78, fat: 0.6, serving: '75g' },
  { id: 'cz-testoviny-suche', name: 'Těstoviny (suché)', category: 'Přílohy', kcal: 350, protein: 12, carbs: 72, fat: 1.5, serving: '85g' },
  { id: 'cz-kecup', name: 'Kečup', category: 'Ostatní', kcal: 110, protein: 1.5, carbs: 25, fat: 0.3, serving: '15g' },
  { id: 'cz-majoneza', name: 'Majonéza', category: 'Ostatní', kcal: 680, protein: 1, carbs: 1, fat: 75, serving: '15g' },
  { id: 'cz-horcice', name: 'Hořčice', category: 'Ostatní', kcal: 66, protein: 4, carbs: 6, fat: 3, serving: '10g' },
  { id: 'cz-proteinovy-prasek', name: 'Proteinový prášek (whey)', category: 'Ostatní', kcal: 380, protein: 75, carbs: 8, fat: 5, serving: '30g' },
];

export default czechFoods;
