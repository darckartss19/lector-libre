export const UI_LANGUAGES = [
  { id: "es", name: "Español" },
  { id: "en", name: "English" },
  { id: "pt", name: "Português" },
];
// Only interface nodes are localized. Book text and user metadata are excluded.
const entries = [
  ["Crear imagen", "Create image", "Criar imagem"],
  ["Texto", "Text", "Texto"],
  ["Estilo", "Style", "Estilo"],
  ["Fondos", "Backgrounds", "Fundos"],
  ["Todos", "All", "Todos"],
  ["Paisajes", "Landscapes", "Paisagens"],
  ["Cielos", "Skies", "Céus"],
  ["Texturas", "Textures", "Texturas"],
  ["Colores", "Colors", "Cores"],
  ["Cielo estrellado", "Starry sky", "Céu estrelado"],
  ["Aurora", "Aurora", "Aurora"],
  ["Mar de luna", "Moonlit sea", "Mar ao luar"],
  ["Montañas en niebla", "Misty mountains", "Montanhas na névoa"],
  ["Lago entre pinos", "Pine lake", "Lago entre pinheiros"],
  ["Dunas al atardecer", "Sunset dunes", "Dunas ao pôr do sol"],
  ["Mar de nubes", "Sea of clouds", "Mar de nuvens"],
  ["Lavanda", "Lavender", "Lavanda"],
  ["Lluvia en la ventana", "Rain on the window", "Chuva na janela"],
  ["Bosque otoñal", "Autumn forest", "Floresta de outono"],
  ["Cumbres nevadas", "Snow peaks", "Picos nevados"],
  ["Costa tropical", "Tropical shore", "Costa tropical"],
  ["Nebulosa", "Nebula", "Nebulosa"],
  ["Luz botánica", "Botanical light", "Luz botânica"],
  ["Amanecer rosado", "Rose dawn", "Amanhecer rosado"],
  ["Cargando fondo…", "Loading background…", "Carregando fundo…"],
  [
    "No se pudo cargar el fondo.",
    "The background could not be loaded.",
    "Não foi possível carregar o fundo.",
  ],
  ["Fondo desconocido.", "Unknown background.", "Fundo desconhecido."],
  [
    "Diseña una imagen con tus propias palabras.",
    "Design an image with your own words.",
    "Crie uma imagem com suas próprias palavras.",
  ],
  [
    "Pulsa Buscar documentos y autoriza una carpeta en el selector de Android. Se revisarán también sus subcarpetas.",
    "Press Search documents and authorize a folder in the Android picker. Its subfolders will also be searched.",
    "Pressione Buscar documentos e autorize uma pasta no seletor do Android. Suas subpastas também serão verificadas.",
  ],
  [
    "La búsqueda revisa las carpetas autorizadas y sus subcarpetas. Añade otra carpeta si faltan libros.",
    "Search checks authorized folders and their subfolders. Add another folder if books are missing.",
    "A busca verifica as pastas autorizadas e suas subpastas. Adicione outra pasta se faltarem livros.",
  ],
  [
    "Si no aparecen tus libros, añade la carpeta donde están guardados o usa Elegir archivos.",
    "If your books do not appear, add the folder where they are stored or use Choose files.",
    "Se seus livros não aparecerem, adicione a pasta onde estão salvos ou use Escolher arquivos.",
  ],
  [
    "Selecciona una carpeta y pulsa Usar esta carpeta en Android.",
    "Select a folder and press Use this folder in Android.",
    "Selecione uma pasta e pressione Usar esta pasta no Android.",
  ],
  [
    "No se autorizó ninguna carpeta. Puedes volver a intentarlo o elegir archivos.",
    "No folder was authorized. You can try again or choose files.",
    "Nenhuma pasta foi autorizada. Você pode tentar novamente ou escolher arquivos.",
  ],
  [
    "No se pudo acceder a la carpeta. Vuelve a autorizarla o usa Elegir archivos.",
    "The folder could not be accessed. Authorize it again or use Choose files.",
    "Não foi possível acessar a pasta. Autorize-a novamente ou use Escolher arquivos.",
  ],
  [
    "Android no concedió acceso a los archivos. Autoriza una carpeta con Añadir carpeta o usa Elegir archivos.",
    "Android did not grant file access. Authorize a folder using Add folder or use Choose files.",
    "O Android não concedeu acesso aos arquivos. Autorize uma pasta com Adicionar pasta ou use Escolher arquivos.",
  ],
  [
    "Android limitó la búsqueda general. Añade una carpeta para buscar dentro de ella.",
    "Android limited the general search. Add a folder to search inside it.",
    "O Android limitou a busca geral. Adicione uma pasta para buscar dentro dela.",
  ],
  [
    "El archivo de este libro no está en el dispositivo. Importa el original para poder leerlo.",
    "This book file is not on this device. Import the original to read it.",
    "O arquivo deste livro não está neste dispositivo. Importe o original para lê-lo.",
  ],
  [
    "Sincronización con Drive",
    "Drive synchronization",
    "Sincronização com Drive",
  ],
  [
    "La sincronización con Drive está desactivada en esta versión pública. Estará disponible en una versión futura.",
    "Drive synchronization is disabled in this public preview. It will be available in a future version.",
    "A sincronização com Drive está desativada nesta versão pública. Estará disponível em uma versão futura.",
  ],
  [
    "Tu biblioteca, progreso y ajustes se guardan en este dispositivo. Puedes trasladarlos con una copia ZIP.",
    "Your library, progress and settings are stored on this device. You can transfer them with a ZIP backup.",
    "Sua biblioteca, progresso e ajustes ficam neste dispositivo. Você pode transferi-los com um backup ZIP.",
  ],
  [
    "Buscar libros en el teléfono",
    "Find books on the phone",
    "Buscar livros no telefone",
  ],
  ["Añadir carpeta", "Add folder", "Adicionar pasta"],
  ["Buscar documentos", "Search documents", "Buscar documentos"],
  ["Detener búsqueda", "Stop search", "Parar busca"],
  ["Filtrar por nombre", "Filter by name", "Filtrar por nome"],
  ["Seleccionar resultados", "Select results", "Selecionar resultados"],
  ["Elegir archivos", "Choose files", "Escolher arquivos"],
  ["Documentos del teléfono", "Phone documents", "Documentos do telefone"],
  ["Compartir imagen", "Share image", "Compartilhar imagem"],
  [
    "Descargar voces en Android",
    "Download Android voices",
    "Baixar vozes no Android",
  ],
  ["Buscando documentos…", "Searching documents…", "Buscando documentos…"],
  ["Preparando documentos…", "Preparing documents…", "Preparando documentos…"],
  [
    "Selecciona los documentos que quieras importar.",
    "Select the documents you want to import.",
    "Selecione os documentos que deseja importar.",
  ],
  [
    "No se encontraron libros. Añade una carpeta para ampliar la búsqueda.",
    "No books found. Add a folder to expand the search.",
    "Nenhum livro encontrado. Adicione uma pasta para ampliar a busca.",
  ],
  [
    "Pulsa Buscar documentos para revisar las carpetas autorizadas.",
    "Press Search documents to check authorized folders.",
    "Pressione Buscar documentos para verificar as pastas autorizadas.",
  ],
  [
    "Búsqueda detenida. Puedes importar los resultados encontrados.",
    "Search stopped. You can import the results found.",
    "Busca interrompida. Você pode importar os resultados encontrados.",
  ],
  [
    "Algunas carpetas no se pudieron leer. Revisa sus permisos y vuelve a buscar.",
    "Some folders could not be read. Check their permissions and search again.",
    "Algumas pastas não puderam ser lidas. Verifique suas permissões e busque novamente.",
  ],
  [
    "Busca documentos visibles y dentro de las carpetas que autorices, incluidas sus subcarpetas. Android puede limitar el acceso a algunas ubicaciones.",
    "Search visible documents and authorized folders, including subfolders. Android may limit access to some locations.",
    "Busque documentos visíveis e pastas autorizadas, incluindo subpastas. O Android pode limitar o acesso a alguns locais.",
  ],
  [
    "Instala los datos de voz desde el motor de texto a voz del teléfono y pulsa Actualizar voces. Se muestran las voces instaladas que funcionan sin conexión.",
    "Install voice data using the phone’s text-to-speech engine, then press Refresh voices. Installed offline voices are listed.",
    "Instale os dados de voz pelo motor de texto para fala do telefone e pressione Atualizar vozes. São exibidas as vozes instaladas que funcionam sem conexão.",
  ],
  [
    "La voz continúa con la pantalla apagada o al cambiar de aplicación. Puedes controlarla desde la notificación. Quitar Lector libre de las aplicaciones recientes detiene la voz y guarda la posición.",
    "Speech continues with the screen off or in another app. Control it from the notification. Removing Lector libre from recent apps stops speech and saves your position.",
    "A voz continua com a tela apagada ou em outro aplicativo. Controle pela notificação. Remover Lector libre dos aplicativos recentes interrompe a voz e salva a posição.",
  ],

  ["Abrir menú", "Open menu", "Abrir menu"],
  ["Cerrar menú", "Close menu", "Fechar menu"],
  ["Herramientas de lectura", "Reading tools", "Ferramentas de leitura"],
  ["Biblioteca local", "Local library", "Biblioteca local"],
  [
    "Esta versión de prueba guarda tus libros y progreso en este dispositivo. La conexión a Drive para Android llegará en una próxima versión.",
    "This test version saves your books and progress on this device. Drive for Android will be available in a future version.",
    "Esta versão de teste salva seus livros e progresso neste dispositivo. O Drive para Android estará disponível em uma próxima versão.",
  ],
  [
    "La voz para Android estará disponible en una próxima versión. Puedes probar la lectura y la organización sin conexión.",
    "Voice for Android will be available in a future version. You can try reading and organizing books offline.",
    "A voz para Android estará disponível em uma próxima versão. Você pode testar a leitura e a organização sem conexão.",
  ],
  ["Vertical sin marcos", "Borderless vertical", "Vertical sem molduras"],
  [
    "Estas páginas son imágenes. Escribe la cita aquí para crear tu tarjeta.",
    "These pages are images. Type the quote here to create your card.",
    "Estas páginas são imagens. Digite a citação aqui para criar seu cartão.",
  ],
  [
    "No se pudo preparar esta sección.",
    "This section could not be prepared.",
    "Não foi possível preparar esta seção.",
  ],
  [
    "No hay documentos compatibles en esta selección.",
    "There are no supported documents in this selection.",
    "Não há documentos compatíveis nesta seleção.",
  ],
  [
    "Este documento no contiene texto para leer en voz alta.",
    "This document contains no text to read aloud.",
    "Este documento não contém texto para leitura em voz alta.",
  ],
  ["Importando biblioteca", "Importing library", "Importando biblioteca"],
  ["Importación en pausa", "Import paused", "Importação pausada"],
  ["Preparando capítulo…", "Preparing chapter…", "Preparando capítulo…"],
  ["Portada no disponible", "Cover unavailable", "Capa indisponível"],
  ["Finalizar", "Finish", "Finalizar"],
  ["Libros pendientes", "Pending books", "Livros pendentes"],
  ["Con error", "With errors", "Com erro"],
  [
    "La importación se pausará al terminar este libro.",
    "Import will pause after this book finishes.",
    "A importação será pausada após concluir este livro.",
  ],
  [
    "Importación terminada. Los duplicados conservan tu progreso.",
    "Import finished. Duplicates retain your progress.",
    "Importação concluída. Os duplicados conservam seu progresso.",
  ],
  [
    "Conecta Google para continuar la importación.",
    "Connect Google to continue importing.",
    "Conecte o Google para continuar a importação.",
  ],
  [
    "Vuelve a seleccionar la carpeta original para continuar.",
    "Select the original folder again to continue.",
    "Selecione novamente a pasta original para continuar.",
  ],
  [
    "Algunos libros quedaron pendientes. Puedes continuar para reintentarlos.",
    "Some books remain pending. Continue to retry them.",
    "Alguns livros ficaram pendentes. Continue para tentar novamente.",
  ],
  ["Páginas de la biblioteca", "Library pages", "Páginas da biblioteca"],
  [
    "Si la página es un escaneo, escribe la cita aquí para crear tu tarjeta.",
    "If the page is a scan, type the quote here to create your card.",
    "Se a página é digitalizada, escreva a citação aqui para criar seu cartão.",
  ],
  ["Clásica", "Classic", "Clássica"],
  ["Limpia", "Clean", "Limpa"],
  ["Redondeada", "Rounded", "Arredondada"],
  ["Máquina de escribir", "Typewriter", "Máquina de escrever"],
  ["Crear tarjeta", "Create card", "Criar cartão"],
  ["Crear tarjeta de cita", "Create quote card", "Criar cartão de citação"],
  [
    "Diseña una imagen para compartir tu lectura.",
    "Design an image to share your reading.",
    "Crie uma imagem para compartilhar sua leitura.",
  ],
  ["Cita", "Quote", "Citação"],
  [
    "Vertical · 1080 × 1920",
    "Vertical · 1080 × 1920",
    "Vertical · 1080 × 1920",
  ],
  ["Cuadrado · 1080 × 1080", "Square · 1080 × 1080", "Quadrado · 1080 × 1080"],
  ["Fondo", "Background", "Fundo"],
  ["Papel", "Paper", "Papel"],
  ["Medianoche", "Midnight", "Meia-noite"],
  ["Bosque", "Forest", "Floresta"],
  ["Ciruela", "Plum", "Ameixa"],
  ["Atardecer", "Sunset", "Pôr do sol"],
  ["Océano", "Ocean", "Oceano"],
  ["Niebla", "Mist", "Névoa"],
  ["Noche cálida", "Warm night", "Noite aconchegante"],
  ["Mi imagen", "My image", "Minha imagem"],
  ["Elegir mi imagen", "Choose my image", "Escolher minha imagem"],
  ["Sorpréndeme", "Surprise me", "Surpreenda-me"],
  ["Capa sobre la imagen", "Image overlay", "Camada sobre a imagem"],
  ["Oscurecer", "Darken", "Escurecer"],
  ["Aclarar", "Lighten", "Clarear"],
  ["Intensidad", "Intensity", "Intensidade"],
  [
    "La imagen se recorta al centro para llenar la tarjeta.",
    "The image is cropped at the center to fill the card.",
    "A imagem é recortada no centro para preencher o cartão.",
  ],
  ["Color del texto", "Text color", "Cor do texto"],
  ["Alineación", "Alignment", "Alinhamento"],
  ["Centrado", "Centered", "Centralizado"],
  ["Izquierda", "Left", "Esquerda"],
  ["Derecha", "Right", "Direita"],
  [
    "Incluir título y autor",
    "Include title and author",
    "Incluir título e autor",
  ],
  ["Vista previa de la tarjeta", "Card preview", "Prévia do cartão"],
  [
    "El tamaño de la letra se ajusta para conservar el fragmento completo.",
    "Font size adjusts to keep the entire passage.",
    "O tamanho da letra se ajusta para preservar o trecho completo.",
  ],
  [
    "Escribe o selecciona una cita.",
    "Write or select a quote.",
    "Escreva ou selecione uma citação.",
  ],
  [
    "El fragmento es demasiado largo para esta tarjeta. Acórtalo o usa el formato vertical.",
    "The passage is too long for this card. Shorten it or use the vertical format.",
    "O trecho é longo demais para este cartão. Encurte-o ou use o formato vertical.",
  ],
  ["Copiar imagen", "Copy image", "Copiar imagem"],
  ["Guardar PNG", "Save PNG", "Salvar PNG"],
  ["Tarjeta guardada.", "Card saved.", "Cartão salvo."],
  [
    "Imagen copiada. Ya puedes pegarla donde quieras compartirla.",
    "Image copied. You can now paste it where you want to share it.",
    "Imagem copiada. Agora você pode colá-la onde quiser compartilhar.",
  ],
  [
    "Cambia a Texto para seleccionar una cita del PDF.",
    "Switch to Text to select a quote from the PDF.",
    "Mude para Texto para selecionar uma citação do PDF.",
  ],
  [
    "Selecciona una frase o un párrafo para crear tu tarjeta.",
    "Select a sentence or paragraph to create your card.",
    "Selecione uma frase ou um parágrafo para criar seu cartão.",
  ],
  [
    "Elige una imagen PNG, JPEG o WebP válida.",
    "Choose a valid PNG, JPEG or WebP image.",
    "Escolha uma imagem PNG, JPEG ou WebP válida.",
  ],
  [
    "No se pudo guardar la tarjeta. Comprueba la carpeta de destino.",
    "Could not save the card. Check the destination folder.",
    "Não foi possível salvar o cartão. Verifique a pasta de destino.",
  ],
  [
    "Usa un nombre terminado en .png.",
    "Use a name ending in .png.",
    "Use um nome terminado em .png.",
  ],
  [
    "No se pudo copiar la imagen. Puedes guardarla como PNG.",
    "Could not copy the image. You can save it as PNG.",
    "Não foi possível copiar a imagem. Você pode salvá-la como PNG.",
  ],
  [
    "No se pudo abrir el portapapeles.",
    "Could not open the clipboard.",
    "Não foi possível abrir a área de transferência.",
  ],
  [
    "No se pudo preparar la tarjeta.",
    "Could not prepare the card.",
    "Não foi possível preparar o cartão.",
  ],
  [
    "No se pudo elegir el destino de la tarjeta.",
    "Could not choose the card destination.",
    "Não foi possível escolher o destino do cartão.",
  ],
  [
    "No se pudo guardar la tarjeta.",
    "Could not save the card.",
    "Não foi possível salvar o cartão.",
  ],
  [
    "No se pudo copiar la imagen.",
    "Could not copy the image.",
    "Não foi possível copiar a imagem.",
  ],
  [
    "La tarjeta debe ser una imagen PNG.",
    "The card must be a PNG image.",
    "O cartão deve ser uma imagem PNG.",
  ],
  [
    "La tarjeta es demasiado grande.",
    "The card is too large.",
    "O cartão é grande demais.",
  ],
  [
    "No se pudo leer la imagen de la tarjeta.",
    "Could not read the card image.",
    "Não foi possível ler a imagem do cartão.",
  ],
  [
    "La tarjeta no contiene una imagen PNG válida.",
    "The card does not contain a valid PNG image.",
    "O cartão não contém uma imagem PNG válida.",
  ],
  [
    "El tamaño de la tarjeta no es válido.",
    "The card dimensions are invalid.",
    "As dimensões do cartão são inválidas.",
  ],
  [
    "Cambia a Texto para seleccionar y anotar un fragmento del PDF.",
    "Switch to Text to select and annotate a PDF passage.",
    "Mude para Texto para selecionar e anotar um trecho do PDF.",
  ],
  [
    "Cambia a la vista Texto para subrayar o escribir notas sobre un fragmento.",
    "Switch to Text view to highlight or write notes about a passage.",
    "Mude para a vista Texto para destacar ou escrever notas sobre um trecho.",
  ],
  [
    "Este PDF no tiene texto reconocible para leer en voz alta.",
    "This PDF has no recognizable text to read aloud.",
    "Este PDF não tem texto reconhecível para ler em voz alta.",
  ],
  ["Vista PDF", "PDF view", "Vista PDF"],
  ["Diseño original", "Original layout", "Layout original"],
  ["Texto", "Text", "Texto"],
  ["Ajustar página", "Fit page", "Ajustar página"],
  ["Ajustar ancho", "Fit width", "Ajustar largura"],
  ["Zoom", "Zoom", "Zoom"],
  ["Girar", "Rotate", "Girar"],
  ["Páginas", "Pages", "Páginas"],
  ["Preparando página…", "Preparing page…", "Preparando página…"],
  ["Contraseña del PDF", "PDF password", "Senha do PDF"],
  ["Contraseña", "Password", "Senha"],
  ["Abrir PDF", "Open PDF", "Abrir PDF"],
  [
    "La contraseña no es correcta. Inténtalo otra vez.",
    "The password is incorrect. Try again.",
    "A senha está incorreta. Tente novamente.",
  ],
  [
    "Este PDF está protegido. Introduce su contraseña para abrirlo.",
    "This PDF is protected. Enter its password to open it.",
    "Este PDF está protegido. Digite sua senha para abri-lo.",
  ],
  [
    "La contraseña no se guarda ni se sincroniza.",
    "The password is not saved or synced.",
    "A senha não é salva nem sincronizada.",
  ],
  [
    "Este PDF no tiene texto reconocible. Puedes leer sus páginas; la voz y la búsqueda necesitan reconocimiento de texto.",
    "This PDF has no recognizable text. You can read its pages; speech and search require text recognition.",
    "Este PDF não tem texto reconhecível. Você pode ler suas páginas; voz e busca precisam de reconhecimento de texto.",
  ],
  [
    "Esta página no tiene texto reconocible. Puedes verla en Diseño original.",
    "This page has no recognizable text. You can see it in Original layout.",
    "Esta página não tem texto reconhecível. Você pode vê-la em Layout original.",
  ],
  [
    "No se pudo mostrar esta página del PDF.",
    "Could not display this PDF page.",
    "Não foi possível mostrar esta página do PDF.",
  ],
  [
    "El PDF necesita una contraseña válida.",
    "The PDF requires a valid password.",
    "O PDF precisa de uma senha válida.",
  ],
  [
    "Se canceló la apertura del PDF.",
    "Opening the PDF was canceled.",
    "A abertura do PDF foi cancelada.",
  ],
  [
    "No se pudo leer el PDF. Puede estar dañado o no ser un PDF válido.",
    "Could not read the PDF. It may be damaged or not a valid PDF.",
    "Não foi possível ler o PDF. Ele pode estar danificado ou não ser um PDF válido.",
  ],
  [
    "Para subrayar o anotar texto, cambia la Vista PDF a Texto.",
    "To highlight or annotate text, change the PDF view to Text.",
    "Para destacar ou anotar texto, mude a Vista PDF para Texto.",
  ],
  [
    "Este PDF necesita reconocimiento de texto para escucharlo.",
    "This PDF needs text recognition to be read aloud.",
    "Este PDF precisa de reconhecimento de texto para ser lido em voz alta.",
  ],

  ["Historial", "History", "Histórico"],
  ["Por leer", "To read", "Para ler"],
  ["Añadidos recientemente", "Recently added", "Adicionados recentemente"],
  [
    "Todos los libros abiertos, incluidos los terminados.",
    "All opened books, including finished ones.",
    "Todos os livros abertos, incluindo os terminados.",
  ],
  [
    "Libros empezados que aún no has terminado.",
    "Books you started and have not finished yet.",
    "Livros começados que ainda não terminou.",
  ],
  [
    "Libros que todavía no has abierto.",
    "Books you have not opened yet.",
    "Livros que ainda não abriu.",
  ],
  [
    "Ordenados por la fecha en que los añadiste.",
    "Sorted by the date you added them.",
    "Ordenados pela data em que os adicionou.",
  ],
  ["Filtros", "Filters", "Filtros"],
  ["Género principal", "Main genre", "Gênero principal"],
  ["Colección", "Collection", "Coleção"],
  ["Idioma del libro", "Book language", "Idioma do livro"],
  ["Formato", "Format", "Formato"],
  ["Estado de lectura", "Reading status", "Estado de leitura"],
  ["Disponibilidad", "Availability", "Disponibilidade"],
  ["Sin indicar", "Unspecified", "Não indicado"],
  ["En este dispositivo", "On this device", "Neste dispositivo"],
  ["Solo en Drive", "Only on Drive", "Somente no Drive"],
  ["Sin archivo disponible", "No file available", "Sem arquivo disponível"],
  ["Todos", "All", "Todos"],
  [
    "Se combinan con la búsqueda y la sección actual. El idioma se toma del libro; los que no lo indican aparecen en «Sin indicar».",
    "Combine filters with search and the current section. Language comes from book metadata; books without it appear as Unspecified.",
    "Combine os filtros com a busca e a seção atual. O idioma vem do livro; os que não o indicam aparecem como Não indicado.",
  ],
  ["Limpiar filtros", "Clear filters", "Limpar filtros"],
  ["Vistas guardadas", "Saved views", "Vistas salvas"],
  ["Elegir vista", "Choose view", "Escolher vista"],
  ["Abrir vista", "Open view", "Abrir vista"],
  ["Eliminar vista", "Delete view", "Excluir vista"],
  ["Nombre de la vista", "View name", "Nome da vista"],
  [
    "Por ejemplo: Aventuras por leer",
    "For example: Adventures to read",
    "Por exemplo: Aventuras para ler",
  ],
  ["Guardar vista", "Save view", "Salvar vista"],
  ["Vista guardada.", "View saved.", "Vista salva."],
  ["Vista eliminada.", "View deleted.", "Vista excluída."],
  [
    "Las vistas se sincronizan. La disponibilidad se comprueba en cada dispositivo. Eliminar una vista conserva los libros.",
    "Views sync. Availability is checked on each device. Deleting a view keeps your books.",
    "As vistas são sincronizadas. A disponibilidade é verificada em cada dispositivo. Excluir uma vista mantém os livros.",
  ],
  ["Modo de lectura", "Reading mode", "Modo de leitura"],
  ["Desplazamiento continuo", "Continuous scrolling", "Rolagem contínua"],
  ["Continuo", "Continuous", "Contínuo"],
  ["Una página", "One page", "Uma página"],
  ["Dos páginas", "Two pages", "Duas páginas"],
  ["Página", "Page", "Página"],
  ["Capítulo", "Chapter", "Capítulo"],
  ["Escuchar desde aquí", "Listen from here", "Ouvir daqui"],
  ["Frase anterior", "Previous sentence", "Frase anterior"],
  ["Frase siguiente", "Next sentence", "Próxima frase"],
  ["← Frase", "← Sentence", "← Frase"],
  ["Frase →", "Sentence →", "Frase →"],
  [
    "No se pudo localizar el fragmento para escucharlo.",
    "Could not locate the passage to read aloud.",
    "Não foi possível localizar o trecho para ouvir.",
  ],
  ["Seleccionar", "Select", "Selecionar"],
  [
    "La copia comenzará al terminar la operación en curso.",
    "The backup will start when the current operation finishes.",
    "A cópia começará quando a operação atual terminar.",
  ],
  ["Colecciones", "Collections", "Coleções"],
  [
    "Colecciones, separadas por comas",
    "Collections, separated by commas",
    "Coleções, separadas por vírgulas",
  ],
  ["Cambiar portada", "Change cover", "Alterar capa"],
  ["Quitar portada", "Remove cover", "Remover capa"],
  [
    "La imagen se usa también para el lomo.",
    "The image is also used for the spine.",
    "A imagem também é usada na lombada.",
  ],
  ["Editar selección", "Edit selection", "Editar seleção"],
  [
    "Solo se cambian los campos que marques.",
    "Only checked fields are changed.",
    "Somente os campos marcados são alterados.",
  ],
  ["Cambiar autor", "Change author", "Alterar autor"],
  ["Reemplazar géneros", "Replace genres", "Substituir gêneros"],
  ["Cambiar saga", "Change series", "Alterar saga"],
  ["Reemplazar colecciones", "Replace collections", "Substituir coleções"],
  [
    "Al cambiar la saga se borra su número anterior. Puedes ordenar cada libro después.",
    "Changing the series clears its previous number. You can order each book afterward.",
    "Alterar a saga apaga seu número anterior. Você pode ordenar cada livro depois.",
  ],
  ["Añadir a colección", "Add to collection", "Adicionar à coleção"],
  ["Nombre de la colección", "Collection name", "Nome da coleção"],
  [
    "Conserva las demás colecciones de cada libro.",
    "Keeps each book's other collections.",
    "Mantém as outras coleções de cada livro.",
  ],
  [
    "Seleccionar visibles",
    "Select visible books",
    "Selecionar livros visíveis",
  ],
  ["Seleccionar libros", "Select books", "Selecionar livros"],
  ["Crear colección", "Create collection", "Criar coleção"],
  [
    "TU BIBLIOTECA, TUS GRUPOS",
    "YOUR LIBRARY, YOUR GROUPS",
    "SUA BIBLIOTECA, SEUS GRUPOS",
  ],
  [
    "Un libro puede pertenecer a varias colecciones.",
    "A book can belong to several collections.",
    "Um livro pode pertencer a várias coleções.",
  ],
  [
    "Buscar colecciones o libros",
    "Search collections or books",
    "Buscar coleções ou livros",
  ],
  [
    "Crea una colección seleccionando libros o desde Editar libro.",
    "Create a collection by selecting books or from Edit book.",
    "Crie uma coleção selecionando livros ou em Editar livro.",
  ],
  [
    "Tus colecciones aparecerán aquí.",
    "Your collections will appear here.",
    "Suas coleções aparecerão aqui.",
  ],
  [
    "Selecciona libros y pulsa Añadir a colección.",
    "Select books and choose Add to collection.",
    "Selecione livros e escolha Adicionar à coleção.",
  ],
  [
    "Organizados por colección",
    "Organized by collection",
    "Organizados por coleção",
  ],
  ["Buscar en el libro", "Search in book", "Buscar no livro"],
  ["Notas", "Notes", "Notas"],
  ["Buscar", "Search", "Buscar"],
  ["Notas y marcadores", "Notes and bookmarks", "Notas e marcadores"],
  ["Cerrar panel", "Close panel", "Fechar painel"],
  [
    "Buscar una palabra o frase",
    "Search for a word or phrase",
    "Buscar uma palavra ou frase",
  ],
  [
    "Los resultados aparecen mientras escribes.",
    "Results appear as you type.",
    "Os resultados aparecem enquanto você digita.",
  ],
  [
    "No se encontraron coincidencias.",
    "No matches found.",
    "Nenhuma correspondência encontrada.",
  ],
  ["Mostrar más resultados", "Show more results", "Mostrar mais resultados"],
  [
    "Selecciona un fragmento para subrayarlo o añadir una nota.",
    "Select a passage to highlight it or add a note.",
    "Selecione um trecho para destacá-lo ou adicionar uma nota.",
  ],
  ["Guardar marcador", "Save bookmark", "Salvar marcador"],
  ["Subrayar", "Highlight", "Destacar"],
  ["Añadir nota", "Add note", "Adicionar nota"],
  ["Marcador", "Bookmark", "Marcador"],
  ["Nota", "Note", "Nota"],
  ["Subrayado", "Highlight", "Destaque"],
  ["Editar", "Edit", "Editar"],
  ["Eliminar", "Delete", "Excluir"],
  [
    "Aún no hay notas o marcadores.",
    "No notes or bookmarks yet.",
    "Ainda não há notas ou marcadores.",
  ],
  ["Nombre (opcional)", "Name (optional)", "Nome (opcional)"],
  ["Nota (opcional)", "Note (optional)", "Nota (opcional)"],
  ["Color", "Color", "Cor"],
  ["Amarillo", "Yellow", "Amarelo"],
  ["Verde", "Green", "Verde"],
  ["Azul", "Blue", "Azul"],
  ["Rosa", "Pink", "Rosa"],
  [
    "Selecciona primero un fragmento del texto.",
    "Select a passage first.",
    "Selecione um trecho primeiro.",
  ],
  [
    "No hay texto visible para guardar un marcador.",
    "There is no visible text to bookmark.",
    "Não há texto visível para salvar um marcador.",
  ],
  [
    "El fragmento guardado ya no coincide con este capítulo.",
    "The saved passage no longer matches this chapter.",
    "O trecho salvo não corresponde mais a este capítulo.",
  ],
  ["Pantalla completa", "Fullscreen", "Tela cheia"],
  ["Temporizador", "Sleep timer", "Temporizador"],
  ["Sin temporizador", "No timer", "Sem temporizador"],
  ["15 minutos", "15 minutes", "15 minutos"],
  ["30 minutos", "30 minutes", "30 minutos"],
  ["60 minutos", "60 minutes", "60 minutos"],
  ["Fin del capítulo", "End of chapter", "Fim do capítulo"],
  ["minutos restantes", "minutes remaining", "minutos restantes"],
  [
    "La voz se detuvo por el temporizador.",
    "The sleep timer stopped the voice.",
    "O temporizador parou a voz.",
  ],
  [
    "La voz se detuvo al terminar el capítulo.",
    "The voice stopped at the end of the chapter.",
    "A voz parou no fim do capítulo.",
  ],
  ["Copia de seguridad", "Backup", "Cópia de segurança"],
  [
    "Guarda tus libros, organización, notas, ajustes y progreso en un archivo ZIP.",
    "Save your books, organization, notes, settings and progress in a ZIP file.",
    "Salve seus livros, organização, notas, ajustes e progresso em um arquivo ZIP.",
  ],
  ["Exportar copia", "Export backup", "Exportar cópia"],
  ["Restaurar copia", "Restore backup", "Restaurar cópia"],
  [
    "Incluye los libros descargados. Los libros que solo están en Drive conservan su referencia. Las credenciales y las voces descargadas no se incluyen.",
    "Includes downloaded books. Books only on Drive keep their reference. Credentials and downloaded voices are not included.",
    "Inclui livros baixados. Livros apenas no Drive mantêm sua referência. Credenciais e vozes baixadas não são incluídas.",
  ],
  [
    "Cómo recuperar la biblioteca",
    "How to restore the library",
    "Como restaurar a biblioteca",
  ],
  [
    "Añadir libros faltantes y conservar datos actuales",
    "Add missing books and keep current data",
    "Adicionar livros ausentes e manter dados atuais",
  ],
  [
    "Recuperar metadatos y progreso de la copia",
    "Restore metadata and progress from backup",
    "Restaurar metadados e progresso da cópia",
  ],
  [
    "Los libros que ya tienes y no aparecen en la copia se conservan.",
    "Existing books not in the backup are kept.",
    "Livros existentes que não estão na cópia são mantidos.",
  ],
  [
    "También restaurar ajustes",
    "Also restore settings",
    "Restaurar ajustes também",
  ],
  ["Restaurar", "Restore", "Restaurar"],
  [
    "Preparando la copia de seguridad…",
    "Preparing backup…",
    "Preparando cópia de segurança…",
  ],
  [
    "Copia de seguridad guardada.",
    "Backup saved.",
    "Cópia de segurança salva.",
  ],
  [
    "Copia restaurada. Se conservaron los demás libros.",
    "Backup restored. Other books were kept.",
    "Cópia restaurada. Os outros livros foram mantidos.",
  ],
  ["Atajos de lectura", "Reading shortcuts", "Atalhos de leitura"],
  [
    "F11: pantalla completa · Esc: volver · Ctrl+F: buscar en el libro · Ctrl+M: marcador · Ctrl+Mayús+H: subrayar · Ctrl+Mayús+N: nota · ←/→: capítulo anterior/siguiente · Ctrl+Espacio: pausar o continuar la voz.",
    "F11: fullscreen · Esc: return · Ctrl+F: search in book · Ctrl+M: bookmark · Ctrl+Shift+H: highlight · Ctrl+Shift+N: note · ←/→: previous/next chapter · Ctrl+Space: pause or resume voice.",
    "F11: tela cheia · Esc: voltar · Ctrl+F: buscar no livro · Ctrl+M: marcador · Ctrl+Shift+H: destacar · Ctrl+Shift+N: nota · ←/→: capítulo anterior/seguinte · Ctrl+Espaço: pausar ou continuar a voz.",
  ],
  ["Sagas", "Series", "Sagas"],
  ["Saga", "Series", "Saga"],
  ["Saga y número", "Series and number", "Saga e número"],
  [
    "Número en la saga (opcional)",
    "Series number (optional)",
    "Número na saga (opcional)",
  ],
  ["Organizados por saga", "Organized by series", "Organizados por saga"],
  [
    "Organizados por género principal",
    "Organized by primary genre",
    "Organizados por gênero principal",
  ],
  ["Todas las sagas", "All series", "Todas as sagas"],
  [
    "LIBROS QUE VAN JUNTOS",
    "BOOKS THAT BELONG TOGETHER",
    "LIVROS QUE COMBINAM",
  ],
  [
    "Reúne cada saga y lee sus libros en orden.",
    "Keep each series together and read its books in order.",
    "Reúna cada saga e leia seus livros em ordem.",
  ],
  [
    "Título, autor, género o saga",
    "Title, author, genre or series",
    "Título, autor, gênero ou saga",
  ],
  [
    "El primer género determina la estantería. Los demás se conservan para buscar.",
    "The first genre determines the shelf. The others are kept for search.",
    "O primeiro gênero determina a estante. Os demais são mantidos para busca.",
  ],
  [
    "Las sagas se toman del EPUB o del campo Saga al editar un libro.",
    "Series come from the EPUB or the Series field when editing a book.",
    "As sagas vêm do EPUB ou do campo Saga ao editar um livro.",
  ],
  [
    "Busca sagas en los EPUB de este dispositivo. Conserva las que ya has elegido.",
    "Find series in EPUBs on this device. Keep the ones you have already chosen.",
    "Busque sagas nos EPUBs deste dispositivo. Mantém as que você já escolheu.",
  ],
  ["Detectar sagas", "Detect series", "Detectar sagas"],
  [
    "Tus sagas aparecerán aquí",
    "Your series will appear here",
    "Suas sagas aparecerão aqui",
  ],
  [
    "Pulsa Detectar sagas o añade el nombre de la saga desde Editar libro.",
    "Select Detect series or add the series name in Edit book.",
    "Selecione Detectar sagas ou adicione o nome da saga em Editar livro.",
  ],
  [
    "No se pudo completar la detección de sagas. Puedes reintentar.",
    "Could not complete series detection. You can retry.",
    "Não foi possível concluir a detecção de sagas. Você pode tentar novamente.",
  ],
  ["Progreso del libro", "Book progress", "Progresso do livro"],
  ["TU ESPACIO PARA LEER", "YOUR SPACE TO READ", "SEU ESPAÇO PARA LER"],
  ["Añadir libros", "Add books", "Adicionar livros"],
  ["Biblioteca", "Library", "Biblioteca"],
  ["Lectura rápida", "Quick reads", "Leitura rápida"],
  ["Recientes", "Recent additions", "Recentes"],
  ["Últimas lecturas", "Recently read", "Últimas leituras"],
  ["En lectura", "Reading", "Em leitura"],
  ["Terminados", "Finished", "Concluídos"],
  ["ESTANTERÍAS", "BOOKSHELVES", "ESTANTES"],
  [
    "Personalizar y sincronizar",
    "Customize and sync",
    "Personalizar e sincronizar",
  ],
  [
    "Biblioteca en este dispositivo",
    "Library on this device",
    "Biblioteca neste dispositivo",
  ],
  ["UN LIBRO, A TU RITMO", "A BOOK, AT YOUR PACE", "UM LIVRO, NO SEU RITMO"],
  ["Tu biblioteca", "Your library", "Sua biblioteca"],
  ["Recién llegados", "New arrivals", "Recém-chegados"],
  ["A tu manera, siempre", "Always your way", "Sempre do seu jeito"],
  ["Orden de esta sección", "Section order", "Ordem desta seção"],
  ["Título", "Title", "Título"],
  ["Autor", "Author", "Autor"],
  ["Fecha de incorporación", "Date added", "Data de adição"],
  [
    "Tus favoritos, sin límite de fijados",
    "Your favorites, with no pin limit",
    "Seus favoritos, sem limite de fixados",
  ],
  ["Organizados por género", "Organized by genre", "Organizados por gênero"],
  ["Buscar libros", "Search books", "Buscar livros"],
  [
    "Título, autor o género",
    "Title, author or genre",
    "Título, autor ou gênero",
  ],
  ["Ordenar biblioteca", "Sort library", "Ordenar biblioteca"],
  ["Vista portadas", "Cover view", "Vista de capas"],
  ["Vista lomos", "Spine view", "Vista de lombadas"],
  ["Vista lista", "List view", "Vista de lista"],
  ["Aún no hay libros aquí", "No books here yet", "Ainda não há livros aqui"],
  [
    "Tu biblioteca está por comenzar",
    "Your library starts here",
    "Sua biblioteca começa aqui",
  ],
  [
    "Prueba otro filtro o añade un libro a esta estantería.",
    "Try another filter or add a book to this shelf.",
    "Tente outro filtro ou adicione um livro a esta estante.",
  ],
  [
    "Un espacio tranquilo para todos tus libros.",
    "A quiet space for all your books.",
    "Um espaço tranquilo para todos os seus livros.",
  ],
  [
    "Añade tus libros y documentos compatibles. Conservaremos una copia local y recordarás dónde te quedaste.",
    "Add your supported books and documents. We keep a local copy and remember where you stopped.",
    "Adicione seus livros e documentos compatíveis. Guardamos uma cópia local e lembramos onde você parou.",
  ],
  [
    "Añadir mis primeros libros",
    "Add my first books",
    "Adicionar meus primeiros livros",
  ],
  [
    "EPUB, PDF, TXT, FB2, DOCX, ODT, HTML, Markdown y CBZ · Lectura sin conexión",
    "EPUB, PDF, TXT, FB2, DOCX, ODT, HTML, Markdown and CBZ · Offline reading",
    "EPUB, PDF, TXT, FB2, DOCX, ODT, HTML, Markdown e CBZ · Leitura offline",
  ],
  ["QUE SE SIENTA TUYO", "MAKE IT YOURS", "DEIXE COM A SUA CARA"],
  [
    "Tu lectura, tu voz y tus preferencias.",
    "Your reading, your voice and your preferences.",
    "Sua leitura, sua voz e suas preferências.",
  ],
  ["Apariencia e idioma", "Appearance and language", "Aparência e idioma"],
  ["Idioma de la aplicación", "App language", "Idioma do aplicativo"],
  ["Tema", "Theme", "Tema"],
  ["Temas nocturnos", "Night themes", "Temas noturnos"],
  ["Temas claros", "Light themes", "Temas claros"],
  ["Papel claro", "Light paper", "Papel claro"],
  ["Sepia", "Sepia", "Sépia"],
  ["Niebla", "Mist", "Névoa"],
  ["Noche", "Night", "Noite"],
  ["Grafito", "Graphite", "Grafite"],
  ["Medianoche", "Midnight", "Meia-noite"],
  ["Bosque nocturno", "Night forest", "Floresta noturna"],
  ["Ciruela", "Plum", "Ameixa"],
  ["Noche cálida", "Warm night", "Noite quente"],
  ["Negro profundo", "Deep black", "Preto profundo"],
  [
    "Personalización de páginas",
    "Page customization",
    "Personalização de páginas",
  ],
  ["Color de la página", "Page color", "Cor da página"],
  ["Seguir el tema", "Follow the theme", "Seguir o tema"],
  ["Tipografía", "Font", "Fonte"],
  ["Literaria", "Literary", "Literária"],
  ["Libro clásico", "Classic book", "Livro clássico"],
  ["Sin remates", "Sans serif", "Sem serifa"],
  ["Lectura amplia", "Wide reading", "Leitura ampla"],
  ["Monoespaciada", "Monospace", "Monoespaçada"],
  ["Tamaño del texto", "Text size", "Tamanho do texto"],
  ["Espacio entre líneas", "Line spacing", "Espaço entre linhas"],
  ["Ancho de la página", "Page width", "Largura da página"],
  ["Márgenes interiores", "Inner margins", "Margens internas"],
  ["Espacio entre párrafos", "Paragraph spacing", "Espaço entre parágrafos"],
  ["Espacio entre letras", "Letter spacing", "Espaço entre letras"],
  ["Alineación", "Alignment", "Alinhamento"],
  ["A la izquierda", "Left aligned", "À esquerda"],
  ["Justificada", "Justified", "Justificado"],
  [
    "Sangría al empezar los párrafos",
    "Indent the first line",
    "Recuo na primeira linha",
  ],
  ["Vista previa de página", "Page preview", "Prévia da página"],
  ["Volver a la lectura", "Back to reading", "Voltar à leitura"],
  ["Restablecer página", "Reset page", "Redefinir página"],
  [
    "A veces, lo único que hace falta es encontrar un momento para seguir leyendo.",
    "Sometimes, all you need is a moment to keep reading.",
    "Às vezes, basta encontrar um momento para continuar lendo.",
  ],
  [
    "Las palabras encuentran su propio ritmo. Ajusta la página hasta que leer resulte cómodo para ti.",
    "Words find their own rhythm. Adjust the page until reading feels comfortable to you.",
    "As palavras encontram seu próprio ritmo. Ajuste a página até que a leitura fique confortável para você.",
  ],
  ["Diseño de los lomos", "Spine design", "Design das lombadas"],
  [
    "Colores e ilustración de la portada",
    "Cover colors and illustration",
    "Cores e ilustração da capa",
  ],
  ["Solo colores de la portada", "Cover colors only", "Somente cores da capa"],
  ["Clásico", "Classic", "Clássico"],
  [
    "Se crean en este dispositivo, sin conexión. Son diseños inspirados en la portada; puedes verlos en la vista Lomos.",
    "Created offline on this device, inspired by the cover. See them in Spine view.",
    "Criados offline neste dispositivo, inspirados na capa. Veja na vista de lombadas.",
  ],
  ["Lectura en voz alta", "Read aloud", "Leitura em voz alta"],
  ["Idioma de la voz", "Voice language", "Idioma da voz"],
  [
    "Automático según el libro",
    "Automatic from the book",
    "Automático conforme o livro",
  ],
  ["Voz de lectura", "Reading voice", "Voz de leitura"],
  ["Velocidad", "Speed", "Velocidade"],
  ["Probar voz", "Preview voice", "Testar voz"],
  ["Actualizar voces", "Refresh voices", "Atualizar vozes"],
  ["Voces para descargar", "Downloadable voices", "Vozes para baixar"],
  ["Descargar voz", "Download voice", "Baixar voz"],
  ["Instalada", "Installed", "Instalada"],
  [
    "Sin voz instalada para este idioma",
    "No installed voice for this language",
    "Nenhuma voz instalada para este idioma",
  ],
  [
    "No hay una voz descargable para este idioma. Puedes usar una voz compatible instalada en Windows.",
    "No downloadable voice is available for this language. You can use a compatible voice installed in Windows.",
    "Não há uma voz para baixar neste idioma. Você pode usar uma voz compatível instalada no Windows.",
  ],
  [
    "Descarga cada voz una vez. Después funciona sin internet; el texto del libro se procesa en tu equipo.",
    "Download each voice once. Then it works offline; book text is processed on your computer.",
    "Baixe cada voz uma vez. Depois ela funciona offline; o texto é processado no seu computador.",
  ],
  [
    "Elige una voz y escúchala antes de empezar. La preferencia se aplica al iniciar o continuar la lectura.",
    "Choose a voice and preview it. The preference applies when starting or resuming reading.",
    "Escolha uma voz e teste. A preferência se aplica ao iniciar ou continuar a leitura.",
  ],
  [
    "La voz sigue leyendo al minimizar la aplicación o cambiar de ventana. Cerrar Lector libre detiene la voz y conserva la posición.",
    "Audio continues when you minimize or switch windows. Closing Lector libre stops audio and saves your position.",
    "O áudio continua ao minimizar ou trocar de janela. Fechar Lector libre para o áudio e salva a posição.",
  ],
  [
    "No se crean archivos de audiolibro.",
    "No audiobook files are created.",
    "Não são criados arquivos de audiolivro.",
  ],
  ["Capítulo", "Chapter", "Capítulo"],
  ["Ajustes", "Settings", "Ajustes"],
  ["Escuchar", "Listen", "Ouvir"],
  ["← Anterior", "← Previous", "← Anterior"],
  ["Siguiente →", "Next →", "Próximo →"],
  ["Pausar", "Pause", "Pausar"],
  ["Continuar", "Resume", "Continuar"],
  ["Detener", "Stop", "Parar"],
  ["Leyendo", "Reading", "Lendo"],
  ["En pausa", "Paused", "Pausado"],
  ["Lectura terminada", "Reading finished", "Leitura concluída"],
  ["Preparando voz", "Preparing voice", "Preparando voz"],
  ["Editar libro", "Edit book", "Editar livro"],
  [
    "Géneros, separados por comas",
    "Genres, separated by commas",
    "Gêneros, separados por vírgulas",
  ],
  ["Cancelar", "Cancel", "Cancelar"],
  ["Guardar cambios", "Save changes", "Salvar alterações"],
  [
    "Tu biblioteca en Google Drive",
    "Your library in Google Drive",
    "Sua biblioteca no Google Drive",
  ],
  ["Biblioteca conectada", "Library connected", "Biblioteca conectada"],
  ["Listo para conectar", "Ready to connect", "Pronto para conectar"],
  [
    "Importar configuración OAuth",
    "Import OAuth configuration",
    "Importar configuração OAuth",
  ],
  ["Reconectar", "Reconnect", "Reconectar"],
  ["Conectar Google", "Connect Google", "Conectar Google"],
  ["Sincronizar ahora", "Sync now", "Sincronizar agora"],
  [
    "Permitir lectura de carpetas",
    "Allow folder reading",
    "Permitir leitura de pastas",
  ],
  [
    "Activar biblioteca en Drive",
    "Enable Drive library",
    "Ativar biblioteca no Drive",
  ],
  [
    "Importar una carpeta existente",
    "Import an existing folder",
    "Importar uma pasta existente",
  ],
  ["Enlace de la carpeta", "Folder link", "Link da pasta"],
  ["Incluir subcarpetas", "Include subfolders", "Incluir subpastas"],
  ["Revisar carpeta", "Review folder", "Revisar pasta"],
  [
    "Usar como carpeta de biblioteca",
    "Use as library folder",
    "Usar como pasta da biblioteca",
  ],
  ["Seleccionar todos", "Select all", "Selecionar todos"],
  ["Quitar selección", "Clear selection", "Limpar seleção"],
  [
    "Descargar automáticamente los libros de la biblioteca para leer sin conexión",
    "Automatically download library books for offline reading",
    "Baixar automaticamente os livros para ler offline",
  ],
  [
    "Si desactivas la descarga automática, cada libro se descargará al abrirlo. Las copias locales que ya tienes se conservan.",
    "When automatic downloads are off, each book downloads when opened. Existing local copies are kept.",
    "Sem downloads automáticos, cada livro será baixado ao abrir. As cópias locais existentes são mantidas.",
  ],
  [
    "Guarda títulos, géneros, fijados, progreso y preferencias en tu cuenta. La primera carpeta que importes queda como tu biblioteca de Drive. Se reutilizan sus archivos y los libros nuevos se suben a esa misma carpeta.",
    "Save titles, genres, pins, progress and preferences in your account. Your first imported folder becomes your Drive library. Its files are reused and new books go to that folder.",
    "Salve títulos, gêneros, fixados, progresso e preferências na sua conta. A primeira pasta importada vira sua biblioteca no Drive. Os arquivos são reutilizados e novos livros vão para a mesma pasta.",
  ],
  [
    "Elige sus EPUB, PDF, TXT, FB2, DOCX, ODT, HTML, Markdown y CBZ, con sus subcarpetas si quieres. Los libros importados mantienen la referencia a su original, sin copiarse de nuevo a Drive.",
    "Choose EPUB, PDF, TXT, FB2, DOCX, ODT, HTML, Markdown and CBZ files, including subfolders if wanted. Imported books keep their original reference without another Drive copy.",
    "Escolha EPUB, PDF, TXT, FB2, DOCX, ODT, HTML, Markdown e CBZ, incluindo subpastas se quiser. Livros importados mantêm a referência ao original, sem nova cópia no Drive.",
  ],
  [
    "Sincronizando con tu Drive…",
    "Syncing with your Drive…",
    "Sincronizando com seu Drive…",
  ],
  [
    "Progreso y preferencias sincronizados.",
    "Progress and preferences synced.",
    "Progresso e preferências sincronizados.",
  ],
  [
    "Pendiente de sincronizar. Tus cambios siguen guardados en este dispositivo.",
    "Sync pending. Your changes are still saved on this device.",
    "Sincronização pendente. Suas alterações continuam salvas neste dispositivo.",
  ],
  [
    "No se pudo guardar en Drive.",
    "Could not save to Drive.",
    "Não foi possível salvar no Drive.",
  ],
  [
    "No hay una voz instalada para ese idioma. Descarga una en los ajustes.",
    "No voice is installed for that language. Download one in settings.",
    "Não há voz instalada para esse idioma. Baixe uma nos ajustes.",
  ],
  [
    "La voz se descargó y está lista para escuchar.",
    "The voice is downloaded and ready.",
    "A voz foi baixada e está pronta.",
  ],
  [
    "Preparando la descarga de voz…",
    "Preparing voice download…",
    "Preparando o download da voz…",
  ],
  [
    "Añade géneros a tus libros para crear estanterías.",
    "Add genres to your books to create shelves.",
    "Adicione gêneros aos seus livros para criar estantes.",
  ],
  ["← Antes", "← Earlier", "← Antes"],
  ["Después →", "Later →", "Depois →"],
  ["Motor de voz", "Voice engine", "Motor de voz"],
  ["Voz", "Voice", "Voz"],
  ["Progreso conectado", "Progress connected", "Progresso conectado"],
  ["Configurar cuenta", "Set up account", "Configurar conta"],
  ["Carpeta de biblioteca", "Library folder", "Pasta da biblioteca"],
  [
    "Activa los archivos para recuperar tus libros en otro equipo. Google pedirá permiso para los archivos creados por el lector.",
    "Enable files to retrieve your books on another computer. Google will request access to files created by the reader.",
    "Ative os arquivos para recuperar seus livros em outro computador. O Google pedirá acesso aos arquivos criados pelo leitor.",
  ],
  [
    "Para leer una carpeta existente, Google concede acceso de lectura a los archivos de tu Drive. El lector consultará las carpetas que elijas. Los originales se conservan.",
    "To read an existing folder, Google grants read access to your Drive files. The reader checks the folders you choose. Originals are kept.",
    "Para ler uma pasta existente, o Google concede acesso de leitura aos arquivos do Drive. O leitor consulta as pastas que você escolher. Os originais são mantidos.",
  ],
  [
    "No hay EPUB, PDF, TXT, FB2, DOCX, ODT, HTML, Markdown o CBZ en esta selección.",
    "There are no EPUB, PDF, TXT, FB2, DOCX, ODT, HTML, Markdown or CBZ files in this selection.",
    "Não há arquivos EPUB, PDF, TXT, FB2, DOCX, ODT, HTML, Markdown ou CBZ nesta seleção.",
  ],
  ["Detener transferencias", "Stop transfers", "Parar transferências"],
  [
    "Los demás libros se conservan. Puedes reintentar la operación.",
    "Other books are kept. You can retry the operation.",
    "Os outros livros são mantidos. Você pode tentar novamente.",
  ],
  [
    "La biblioteca funciona sin cuenta.",
    "The library works without an account.",
    "A biblioteca funciona sem conta.",
  ],
  ["Última sincronización:", "Last sync:", "Última sincronização:"],
  ["Última sincronización: ", "Last sync: ", "Última sincronização: "],
  [
    "Desconectar y revocar permiso",
    "Disconnect and revoke access",
    "Desconectar e revogar acesso",
  ],
  [
    "Se usa la posición más reciente. Las anteriores permanecen en la copia local.",
    "The most recent position is used. Earlier positions remain in the local copy.",
    "A posição mais recente é usada. As anteriores permanecem na cópia local.",
  ],
  [
    "EPUB, PDF, TXT, FB2, DOCX, ODT, HTML, Markdown y CBZ · Sin topes de tamaño, libros o subcarpetas · OneDrive llegará después.",
    "EPUB, PDF, TXT, FB2, DOCX, ODT, HTML, Markdown and CBZ · No size, book or subfolder limits · OneDrive is coming later.",
    "EPUB, PDF, TXT, FB2, DOCX, ODT, HTML, Markdown e CBZ · Sem limites de tamanho, livros ou subpastas · OneDrive chegará depois.",
  ],
  [
    "Selecciona uno o varios EPUB, PDF, TXT, FB2, DOCX, ODT, HTML, Markdown o CBZ.",
    "Select one or more EPUB, PDF, TXT, FB2, DOCX, ODT, HTML, Markdown or CBZ files.",
    "Selecione um ou mais arquivos EPUB, PDF, TXT, FB2, DOCX, ODT, HTML, Markdown ou CBZ.",
  ],
  [
    "Este archivo no está en el dispositivo. Activa la biblioteca en Drive o importa el archivo original.",
    "This file is not on this device. Enable the Drive library or import the original file.",
    "Este arquivo não está neste dispositivo. Ative a biblioteca no Drive ou importe o arquivo original.",
  ],
  [
    "Recuperando el libro de Drive…",
    "Retrieving the book from Drive…",
    "Recuperando o livro do Drive…",
  ],
  [
    "Completa el permiso de Google en el navegador.",
    "Complete Google authorization in your browser.",
    "Conclua a autorização do Google no navegador.",
  ],
  [
    "No se concedió la lectura de carpetas. Tu conexión anterior sigue disponible.",
    "Folder reading was not authorized. Your previous connection is still available.",
    "A leitura de pastas não foi autorizada. Sua conexão anterior continua disponível.",
  ],
  [
    "No se concedió el acceso a los libros.",
    "Book access was not authorized.",
    "O acesso aos livros não foi autorizado.",
  ],
  [
    "Cuenta de Google conectada.",
    "Google account connected.",
    "Conta do Google conectada.",
  ],
  ["Revisando carpeta…", "Reviewing folder…", "Revisando pasta…"],
  ["Preparando importación…", "Preparing import…", "Preparando importação…"],
  [
    "Deteniendo las transferencias. Se conservan los libros ya guardados.",
    "Stopping transfers. Books already saved are kept.",
    "Parando transferências. Os livros já salvos são mantidos.",
  ],
  [
    "Configuración importada en el almacén seguro de Windows.",
    "Configuration imported into the secure Windows store.",
    "Configuração importada para o armazenamento seguro do Windows.",
  ],
  [
    "Configuración pendiente.",
    "Configuration pending.",
    "Configuração pendente.",
  ],
  [
    "Permiso de Google revocado.",
    "Google access revoked.",
    "Acesso do Google revogado.",
  ],
  [
    "No se pudo leer Drive.",
    "Could not read Drive.",
    "Não foi possível ler o Drive.",
  ],
  [
    "No se pudo crear la copia en Drive.",
    "Could not create the Drive copy.",
    "Não foi possível criar a cópia no Drive.",
  ],
  [
    "No se pudo leer una copia de Drive.",
    "Could not read a Drive copy.",
    "Não foi possível ler uma cópia do Drive.",
  ],
  [
    "No se pudo conectar con Google.",
    "Could not connect to Google.",
    "Não foi possível conectar ao Google.",
  ],
  [
    "No se pudo renovar la conexión con Google.",
    "Could not renew the Google connection.",
    "Não foi possível renovar a conexão com o Google.",
  ],
  [
    "Se canceló el permiso de Google.",
    "Google authorization was cancelled.",
    "A autorização do Google foi cancelada.",
  ],
  [
    "Google devolvió una respuesta no válida.",
    "Google returned an invalid response.",
    "O Google retornou uma resposta inválida.",
  ],
  [
    "Se necesita un enlace de carpeta de Google Drive.",
    "A Google Drive folder link is required.",
    "É necessário um link de pasta do Google Drive.",
  ],
  [
    "Autoriza primero la lectura de carpetas de Drive.",
    "Authorize Drive folder reading first.",
    "Autorize primeiro a leitura de pastas do Drive.",
  ],
  [
    "Activa primero la biblioteca en Drive para sincronizar archivos.",
    "Enable the Drive library first to sync files.",
    "Ative primeiro a biblioteca no Drive para sincronizar arquivos.",
  ],
  [
    "La carpeta de biblioteca no está disponible. Elige otra carpeta; no se creará una automáticamente.",
    "The library folder is unavailable. Choose another folder; a new one will not be created automatically.",
    "A pasta da biblioteca não está disponível. Escolha outra pasta; nenhuma será criada automaticamente.",
  ],
  [
    "La carpeta de biblioteca permite lectura, pero no añadir libros. No se creará otra carpeta.",
    "The library folder allows reading but not adding books. Another folder will not be created.",
    "A pasta da biblioteca permite leitura, mas não adicionar livros. Nenhuma outra pasta será criada.",
  ],
  [
    "El original cambió o ya no está disponible. Se conserva el libro local sin duplicarlo; revisa su carpeta.",
    "The original changed or is unavailable. The local book is kept without duplication; check its folder.",
    "O original mudou ou não está disponível. O livro local é mantido sem duplicação; confira sua pasta.",
  ],
  [
    "El libro aún no fue subido desde el equipo original.",
    "The book has not been uploaded from the original computer yet.",
    "O livro ainda não foi enviado do computador original.",
  ],
  [
    "No se pudo descargar la voz. Comprueba la conexión.",
    "Could not download the voice. Check your connection.",
    "Não foi possível baixar a voz. Verifique a conexão.",
  ],
  [
    "No se pudo guardar la descarga de voz.",
    "Could not save the voice download.",
    "Não foi possível salvar o download da voz.",
  ],
  [
    "El tamaño de la voz no coincide con el catálogo.",
    "The voice size does not match the catalog.",
    "O tamanho da voz não corresponde ao catálogo.",
  ],
  [
    "La descarga de voz no pasó la comprobación de integridad. Puedes reintentar.",
    "The voice download failed its integrity check. You can retry.",
    "O download da voz falhou na verificação de integridade. Você pode tentar novamente.",
  ],
  [
    "El motor descargado está incompleto.",
    "The downloaded engine is incomplete.",
    "O motor baixado está incompleto.",
  ],
  [
    "Ya existe una descarga de esa voz. Se conserva para revisión.",
    "A download of this voice already exists. It is kept for review.",
    "Já existe um download dessa voz. Ele é mantido para revisão.",
  ],
];
const dictionaries = {
  es: new Map(entries.map(([es]) => [es, es])),
  en: new Map(entries.map(([es, en]) => [es, en])),
  pt: new Map(entries.map(([es, , pt]) => [es, pt])),
};
export function translate(text, language = "es") {
  language = Object.hasOwn(dictionaries, language) ? language : "es";
  const dictionary = dictionaries[language];
  if (dictionary.has(text)) return dictionary.get(text);
  if (language === "es") return text;
  const en = language === "en";
  const patterns = [
    [
      /^(\d+) libros seleccionados$/,
      en ? "$1 books selected" : "$1 livros selecionados",
    ],
    [
      /^(\d+) libros en la copia$/,
      en ? "$1 books in backup" : "$1 livros na cópia",
    ],
    [/^Seleccionar ([\s\S]+)$/, en ? "Select $1" : "Selecionar $1"],
    [
      /^(\d+) (libro|libros)$/,
      (_, count) =>
        en
          ? `${count} ${count === "1" ? "book" : "books"}`
          : `${count} ${count === "1" ? "livro" : "livros"}`,
    ],
    [
      /^Leyendo sagas: (\d+) de (\d+)…$/,
      en ? "Reading series: $1 of $2…" : "Lendo sagas: $1 de $2…",
    ],
    [
      /^(\d+) libros agrupados en sagas\.(?: No se pudieron revisar (\d+) libros\.)?$/,
      (_, count, failed) =>
        en
          ? `${count} books grouped into series.${failed ? ` Could not check ${failed} books.` : ""}`
          : `${count} livros agrupados em sagas.${failed ? ` Não foi possível verificar ${failed} livros.` : ""}`,
    ],
    [
      /^(\d+) (?:libro|libros) · tu próxima lectura empieza aquí$/,
      (_, count) =>
        en
          ? `${count} ${count === "1" ? "book" : "books"} · your next read starts here`
          : `${count} ${count === "1" ? "livro" : "livros"} · sua próxima leitura começa aqui`,
    ],
    [
      /^Carpeta de biblioteca: ([\s\S]+)$/,
      en ? "Library folder: $1" : "Pasta da biblioteca: $1",
    ],
    [/^Leer ([\s\S]+)$/, en ? "Read $1" : "Ler $1"],
    [/^Portada de ([\s\S]+)$/, en ? "Cover of $1" : "Capa de $1"],
    [/^Fijar ([\s\S]+)$/, en ? "Pin $1" : "Fixar $1"],
    [/^Desfijar ([\s\S]+)$/, en ? "Unpin $1" : "Desafixar $1"],
    [/^Editar ([\s\S]+)$/, en ? "Edit $1" : "Editar $1"],
    [
      /^Quitar de lectura rápida: ([\s\S]+)$/,
      en ? "Unpin: $1" : "Desafixar: $1",
    ],
    [
      /^Importar seleccionados \((\d+)\)$/,
      en ? "Import selected ($1)" : "Importar selecionados ($1)",
    ],
    [/^Página (\d+) de (\d+)$/, en ? "Page $1 of $2" : "Página $1 de $2"],
    [/^(\d+)% LEÍDO$/, en ? "$1% READ" : "$1% LIDO"],
    [/^(\d+)% leído$/, en ? "$1% read" : "$1% lido"],
    [
      /^(En Drive|Archivo pendiente) · ([\s\S]+)$/,
      (_, status, remainder) =>
        `${status === "En Drive" ? (en ? "On Drive" : "No Drive") : en ? "File pending" : "Arquivo pendente"} · ${translate(remainder, language)}`,
    ],
    [
      /^([\s\S]+) · (\d+) libros compatibles$/,
      en ? "$1 · $2 compatible books" : "$1 · $2 livros compatíveis",
    ],
    [
      /^(\d+) archivos omitidos: formatos no compatibles\.$/,
      en
        ? "$1 files skipped: unsupported formats."
        : "$1 arquivos ignorados: formatos incompatíveis.",
    ],
    [
      /^(\d+) archivos pendientes$/,
      en ? "$1 pending files" : "$1 arquivos pendentes",
    ],
    [
      /^(\d+) posiciones anteriores conservadas$/,
      en ? "$1 earlier positions kept" : "$1 posições anteriores mantidas",
    ],
    [
      /^Última sincronización: ([\s\S]+)$/,
      en ? "Last sync: $1" : "Última sincronização: $1",
    ],
    [
      /^Carpeta guardada: ([\s\S]+)\. La sincronización reutilizará sus libros\.$/,
      en
        ? "Folder saved: $1. Sync will reuse its books."
        : "Pasta salva: $1. A sincronização reutilizará seus livros.",
    ],
    [
      /^Importando (\d+) de (\d+) · ([\s\S]+)$/,
      en ? "Importing $1 of $2 · $3" : "Importando $1 de $2 · $3",
    ],
    [
      /^Libro (\d+) de (\d+) · ([\s\S]+)$/,
      en ? "Book $1 of $2 · $3" : "Livro $1 de $2 · $3",
    ],
    [
      /^Comprobando biblioteca · carpeta (\d+)…$/,
      en
        ? "Checking library · folder $1…"
        : "Verificando biblioteca · pasta $1…",
    ],
    [
      /^Revisando carpeta (\d+)…$/,
      en ? "Reviewing folder $1…" : "Revisando pasta $1…",
    ],
    [/^Subiendo ([\s\S]+)…$/, en ? "Uploading $1…" : "Enviando $1…"],
    [/^Descargando ([\s\S]+)…$/, en ? "Downloading $1…" : "Baixando $1…"],
    [
      /^(\d+) (?:libro añadido|libros añadidos)\. Los duplicados conservan tu progreso\.$/,
      (_, count) =>
        en
          ? `${count} ${count === "1" ? "book added" : "books added"}. Duplicates keep your progress.`
          : `${count} ${count === "1" ? "livro adicionado" : "livros adicionados"}. Duplicados mantêm seu progresso.`,
    ],
    [
      /^(\d+) libros añadidos, (\d+) duplicados reconocidos(\. Importación detenida\.)?\.?$/,
      (_, count, duplicates, stopped) =>
        en
          ? `${count} books added, ${duplicates} duplicates recognized.${stopped ? " Import stopped." : ""}`
          : `${count} livros adicionados, ${duplicates} duplicados reconhecidos.${stopped ? " Importação interrompida." : ""}`,
    ],
    [
      /^(\d+) libros subidos, (\d+) recuperados\. (Biblioteca sincronizada\.|\d+ pendientes\.)$/,
      (_, up, down, status) =>
        en
          ? `${up} books uploaded, ${down} retrieved. ${status === "Biblioteca sincronizada." ? "Library synced." : status.replace("pendientes", "pending")}`
          : `${up} livros enviados, ${down} recuperados. ${status === "Biblioteca sincronizada." ? "Biblioteca sincronizada." : status.replace("pendientes", "pendentes")}`,
    ],
    [
      /^(Leyendo|En pausa|Lectura terminada|Preparando voz) · ([\s\S]+)$/,
      (_, status, details) =>
        `${status === "Leyendo" ? (en ? "Reading aloud" : "Lendo em voz alta") : translate(status, language)} · ${details}`,
    ],
    [
      /^(Motor de voz|Voz) · (\d+)%$/,
      (_, phase, progress) => `${translate(phase, language)} · ${progress}%`,
    ],
    [
      /^(No se pudo guardar: |No se pudo abrir el libro: |No se pudo guardar antes de cerrar\. )([\s\S]+)$/,
      (_, prefix, detail) =>
        `${{ "No se pudo guardar: ": en ? "Could not save: " : "Não foi possível salvar: ", "No se pudo abrir el libro: ": en ? "Could not open the book: " : "Não foi possível abrir o livro: ", "No se pudo guardar antes de cerrar. ": en ? "Could not save before closing. " : "Não foi possível salvar antes de fechar. " }[prefix]}${translate(detail, language)}`,
    ],
    [
      /^La descarga de voz devolvió (\d+)\.$/,
      en ? "Voice download returned $1." : "O download da voz retornou $1.",
    ],
  ];
  for (const [pattern, replacement] of patterns)
    if (pattern.test(text)) return text.replace(pattern, replacement);
  return text;
}
const CONTENT =
  '.prose,.book-title,.book-info p,.cover,.genres button,.reader-header h2,#chapter option,.drive-file-list strong,.drive-file-list label span,select[data-preference="voice"] option:not([value=""]),[data-content],script,style,textarea,[contenteditable="true"]';
// Retain the Spanish source for each interface node. Localizing a container twice
// is harmless, and changing languages also works without rebuilding its DOM.
const textSources = new WeakMap();
const attributeSources = new WeakMap();
function localizedValue(previous, current, language) {
  const source = previous?.rendered === current ? previous.source : current;
  const trimmed = source.trim();
  const rendered = trimmed
    ? source.replace(trimmed, translate(trimmed, language))
    : source;
  return { source, rendered };
}
export function localizeUI(container, language = "es") {
  if (!container) return;
  const document = container.ownerDocument ?? container;
  const walker = document.createTreeWalker(container, 4 /* SHOW_TEXT */);
  let node;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest(CONTENT)) continue;
    const result = localizedValue(
      textSources.get(node),
      node.textContent,
      language,
    );
    textSources.set(node, result);
    if (result.rendered !== node.textContent)
      node.textContent = result.rendered;
  }
  const selector =
    "[aria-label],[placeholder],[title],optgroup[label],img[alt]";
  const elements = [
    ...(container.matches?.(selector) ? [container] : []),
    ...container.querySelectorAll(selector),
  ];
  for (const element of elements) {
    const isContent = !!element.closest(CONTENT);
    const sources = attributeSources.get(element) ?? new Map();
    for (const attr of ["aria-label", "placeholder", "title", "label", "alt"]) {
      if (!element.hasAttribute(attr)) continue;
      // A book's tooltip/title is metadata. Only translate the action words in
      // reader controls, preserving the title after them verbatim.
      const bookControl =
        !!element.closest(".book-card") &&
        !element.closest(".prose,[data-content]");
      const bookAction =
        bookControl &&
        attr === "aria-label" &&
        element.matches("[data-open],[data-pin],[data-edit]");
      const coverDescription =
        bookControl && attr === "alt" && element.matches(".cover img");
      if (isContent && !bookAction && !coverDescription) continue;
      const current = element.getAttribute(attr);
      const result = localizedValue(sources.get(attr), current, language);
      if (bookAction && !/^(?:Leer|Fijar|Desfijar|Editar) /.test(result.source))
        continue;
      if (coverDescription && !/^Portada de /.test(result.source)) continue;
      sources.set(attr, result);
      if (result.rendered !== current)
        element.setAttribute(attr, result.rendered);
    }
    attributeSources.set(element, sources);
  }
}
