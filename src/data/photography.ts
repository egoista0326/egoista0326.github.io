import { photographyCategories } from './photographyVocab';

export const photographyProfile = {
  title: 'Jiaxin Li Photography',
  intro:
    'I am Jiaxin Li, a master\'s student in Robotics, Systems and Control at ETHz, Switzerland. I started learning photography in June 2025, and I am especially drawn to street photography.',
  introParagraphs: [
    'I am Jiaxin Li, a master\'s student in Robotics, Systems and Control at ETHz, Switzerland. I started learning photography in June 2025, and I am especially drawn to street photography.',
    'Photography has made me slow down and notice small moments I used to walk past: a gesture, a patch of light, or a reflection on glass. Before, I might have missed them completely. Now I pause, press the shutter, and keep that instant as a memory I can return to.'
  ],
  introImage: {
    src: '/assets/photography/profile-shadow-2649.webp',
    alt: 'Reflected self-portrait of Jiaxin Li.'
  },
  landingCopy: {
    en: {
      title: 'Jiaxin Li Photography',
      introParagraphs: [
        'I am Jiaxin Li, a master\'s student in Robotics, Systems and Control at ETHz, Switzerland. I started learning photography in June 2025, and I am especially drawn to street photography.',
        'Photography has made me slow down and notice small moments I used to walk past: a gesture, a patch of light, or a reflection on glass. Before, I might have missed them completely. Now I pause, press the shutter, and keep that instant as a memory I can return to.'
      ],
      controls: {
        preferences: 'Display preferences',
        theme: 'Theme',
        light: 'Light',
        dark: 'Dark',
        language: 'Language',
        english: 'EN',
        chinese: '中文'
      },
      contact: {
        ariaLabel: 'Photography contact',
        instagram: 'Open Instagram',
        rednote: 'Show Rednote Card'
      },
      sections: {
        news: 'News',
        projects: 'Projects',
        tags: 'Tags',
        categories: 'Categories',
        selectedWorks: 'Selected Works'
      },
      copy: {
        tags: 'Browse by location, camera, lens, and shooting conditions.',
        tagLink: 'Photography Tags',
        categories: '',
        selectedEmpty:
          'A small development set is being used to shape the browsing experience; the full selected import comes next.',
        projectStart: 'Start date'
      },
      categoryLabels: {
        'still-life': 'Still Life',
        landscape: 'Landscape',
        street: 'Street',
        abstract: 'Abstract',
        'black-and-white': 'Black and White',
        architecture: 'Architecture'
      }
    },
    zh: {
      title: 'Jiaxin Li 摄影',
      introParagraphs: [
        '我是 Jiaxin Li，目前在瑞士 ETHz 攻读 Robotics, Systems and Control 硕士。我从 2025 年 6 月开始学习摄影，现在尤其喜欢街头摄影。',
        '摄影让我慢下来，开始注意那些以前会擦肩而过的小瞬间：一个手势、一束光，或者玻璃上的一处反射。过去我可能根本不会留意它们。现在我会停下来，按下快门，把那一瞬间定格成一段以后还能反复回看、慢慢想起的记忆。'
      ],
      controls: {
        preferences: '显示设置',
        theme: '主题',
        light: '浅色',
        dark: '深色',
        language: '语言',
        english: 'EN',
        chinese: '中文'
      },
      contact: {
        ariaLabel: '摄影联系方式',
        instagram: '打开 Instagram',
        rednote: '查看小红书名片'
      },
      sections: {
        news: '动态',
        projects: '项目',
        tags: '标签',
        categories: '分类',
        selectedWorks: '精选作品'
      },
      copy: {
        tags: '按地点、相机、镜头和拍摄条件浏览照片。',
        tagLink: '浏览摄影标签',
        categories: '',
        selectedEmpty: '当前使用一组小规模作品来打磨浏览体验；完整精选导入会在后续继续完善。',
        projectStart: '开始时间'
      },
      categoryLabels: {
        'still-life': '静物',
        landscape: '风光',
        street: '街头',
        abstract: '抽象',
        'black-and-white': '黑白',
        architecture: '建筑'
      }
    }
  },
  email: 'ljx2986519980@gmail.com',
  instagram: {
    label: 'Open Instagram',
    url: 'https://www.instagram.com/egoista_li2003?igsh=MWVkeXh5anZmZzluOQ%3D%3D&utm_source=qr'
  },
  rednote: {
    label: 'Show Rednote Card',
    closeLabel: 'Close Rednote Card',
    title: 'Rednote Card',
    displayName: 'egoista',
    id: '2989511395',
    cardImage: '/assets/photography/rednote-card.jpg',
    alt: 'Rednote card for egoista, Rednote ID 2989511395.'
  },
  workTypeLabel: 'Work Types',
  workTypes: photographyCategories
};

export const photographyNews = [
  {
    date: '2025.6',
    text: 'bought my first camera, a Nikon Zf.',
    textZh: '买下第一台相机：Nikon Zf。'
  }
] as const;

export const photographySelectedWorkSlugs = [
  'dsc-8596',
  'dsc-0046',
  'dsc-2723',
  'dsc-0213',
  'dsc-9185',
  'dsc-2583',
  'dsc-0855',
  'dsc-2862',
  'dsc-8652',
  'dsc-0430',
  'dsc-0255',
  'dsc-9595',
  'dsc-2440',
  'dsc-8044',
  'dsc-0714',
  'dsc-7871',
  'dsc-0155',
  'dsc-2233',
  'dsc-2725',
  'dsc-0244',
  'dsc-9149'
] as const;

export const photographyProjects = [
  {
    slug: 'moments-in-the-room',
    title: 'Moments in the Room',
    titleZh: '房间里的片刻',
    startDate: '2026.1',
    summary: 'A quiet still-life project about brief moments of light and beauty found at home.',
    summaryZh: '一个记录家中偶然光影和美好片刻的静物项目。',
    description:
      'One day I noticed a glass beside my desk catching the sunlight, and the room suddenly felt worth photographing. This project is a way of paying attention to those small domestic moments: snow beyond a window, a fading flower, a spiderweb in the light, or a cup casting shadows. They are not arranged to feel important. They are quiet things I might otherwise miss, kept because they made an ordinary room feel briefly beautiful.',
    descriptionZh:
      '有一天我突然注意到桌边的玻璃杯被阳光照得很好看，才发现家里其实也有很多值得停下来的瞬间。这个项目记录这些偶然出现的小片刻：窗外的雪、渐渐枯萎的花、光里的蛛网，或者杯子投下的影子。它们不是被刻意安排成很重要的画面，只是一些在日常里容易错过、但让我觉得房间在某个瞬间变得很好看的安静事物。',
    photoSlugs: ['dsc-2224', 'dsc-2440', 'dsc-2583', 'dsc-2488', 'dsc-0430', 'dsc-0294', 'dsc-2759']
  },
  {
    slug: 'urban-isolation',
    title: 'Through Glass, From a Distance',
    titleZh: '城市孤岛',
    startDate: '2025.11',
    summary: 'A street project about seeing people through glass, rain, and reflections, staying close enough to notice them and far enough not to interrupt.',
    summaryZh: '一个关于透过玻璃、雨水和反射看街头的项目：靠近到可以看见细节，也保持足够距离，不去打扰。',
    description:
      'I keep returning to Saul Leiter\'s photographs for the quiet distance in them. The street is close, and the people are close, but glass, rain, color, and reflection soften what we see. This project starts from that way of looking. I watch people through windows, reflections, and wet surfaces, curious about their gestures and the lives around them, while choosing not to step too close. The blur and distance let the moments stay open and quiet.',
    descriptionZh:
      '我一直很喜欢 Saul Leiter 照片里的那种安静的距离。街道很近，人也很近，但玻璃、雨水、颜色和反射会把眼前的一切轻轻隔开。这个项目从这种观看方式出发：我透过窗、倒影和潮湿的表面看街头上的人，好奇他们的动作和各自的生活，同时也选择不走得太近。模糊和距离让这些瞬间保留了一点开放感，也让它们安静地留在画面里。',
    photoSlugs: ['dsc-0046', 'dsc-0086', 'dsc-0152', 'dsc-0163', 'dsc-2799', 'dsc-2862']
  }
] as const;

export type PhotographyProject = (typeof photographyProjects)[number];
