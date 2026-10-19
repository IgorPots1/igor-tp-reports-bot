// Reviews for /trial. Source: the Russian screenshots in public/intensive/
// (the same ones /camp shows). Each text is a faithful translation of the
// screenshot, nothing added or polished. The screenshot stays on the page as
// proof under "Show original".
//
// Only reviews that fit the 1:1 7-day format are kept (Igor, 19.10.2026):
// every review that mentions two weeks, a webinar, a group, other
// participants, a team, community or chats is left out on purpose. Do not
// edit a review to make it fit: that would no longer be a translation.

export type TrialReview = {
  name: string;
  img: string;
  width: number;
  height: number;
  text: string[];
};

export const TRIAL_REVIEWS: TrialReview[] = [
  {
    name: "Lex",
    img: "/intensive/rev-01-lex.jpg",
    width: 520,
    height: 531,
    text: [
      "Good afternoon, Igor!",
      "I want to thank you for a very well organized intensive! After a short break in regular training because of a vacation, it was much easier for me to get back into the process and keep training, thanks to the intensive. I really liked the workouts, your individual approach and the way the load was dosed. Everything was great!",
      "Huge thanks for your work and support! ❤️",
    ],
  },
  {
    name: "Lubava Vairich",
    img: "/intensive/rev-02-lubava.jpg",
    width: 520,
    height: 379,
    text: [
      "Good evening!!! Igor, it was very comfortable and clear to work with your instructions 🙌 Thank you for always being in touch, thank you for the expert advice! Running was a pure pleasure. I will recommend you to my friends!!! Thank you for your understanding and for all the work 🏃‍♀️💪 This is not goodbye!!!",
    ],
  },
  {
    name: "Anna Kulikova",
    img: "/intensive/rev-06-anna.jpg",
    width: 520,
    height: 355,
    text: [
      "Thank you so much for the intensive! On a whim, 3 weeks before the race, I decided to run a half marathon, so I had to prepare the express way 😅 Igor helped a lot, and it all worked out! A clear training program, a sensible plan and answers to all the questions I needed! Thank you from the bottom of my heart ❤️",
    ],
  },
  {
    name: "Viktoria",
    img: "/intensive/rev-07-viktoria.jpg",
    width: 520,
    height: 767,
    text: [
      "I was lucky. Only one week passed between the first idea and a couple of runs on my own, and having clear running instructions in my life. So I started in ideal conditions: professional, structured, and all of it felt comfortable, without overdoing it. The coach is attentive and always in touch. You can't hide at the back of the class :) I am very, very happy with everything!",
      "I ran 40 minutes without stopping (!) and even tried the joy of getting up at 6 am and going for a run on vacation, by the sea..",
      "100% individual approach, whether you are a beginner or an advanced runner.",
      "Thank you so much for the project and a wonderful experience!",
    ],
  },
  {
    name: "Darya_smm_photo",
    img: "/intensive/rev-09-darya.jpg",
    width: 520,
    height: 519,
    text: [
      "I have been running for 4 months, without a coach. I have done 3 races. I am preparing for a new one. With Igor I understood that it is better to train smart 😄 with a coach. These are clear workouts, how to run. And you run by the plan. During the intensive my pace got better, and I stopped nervously watching my heart rate. And I started running laps calmly, without counting them.",
      "11/10 for sure. Thank you",
    ],
  },
  {
    name: "Maria Turkina",
    img: "/intensive/rev-16-maria.jpg",
    width: 520,
    height: 387,
    text: [
      "Hi Igor!)",
      "I want to say that joining the intensive was one of my best decisions 🔥",
      "I discovered a new world of running workouts, varied and useful, and I saw running from a different side!) I believe running is with me for a long time now)) Thank you for the technique corrections, the support and the individual approach!",
      "On to new wins 🚀💪",
    ],
  },
];
