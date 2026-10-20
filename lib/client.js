window.__ModuleLoader__.load({
  id: 'dsh-custom-brand',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    // Stamped by the host half on every page load; null when the page was
    // served before this plugin mounted, in which case the fallbacks below keep
    // the row looking intentional.
    const stamped =
      typeof window !== 'undefined' && window.DshBrandSlot && typeof window.DshBrandSlot === 'object'
        ? window.DshBrandSlot
        : null
    const cfg = stamped || {}

    /** Read one configured value, treating empty strings as "not set". */
    const value = (key, fallback) => {
      const current = cfg[key]
      return current === undefined || current === null || current === '' ? fallback : current
    }

    const markSrc = String(value('markUrl', '/api/dsh-custom-brand/mark'))
    const markMode = String(value('markMode', 'glyph'))
    const markColor = String(value('markColor', 'currentColor'))
    const markRadius = String(value('markRadius', '50%'))
    const markSize = Number(value('markSize', 24))
    const nameText = stamped ? String(stamped.name ?? '').trim() : '大肥鱼'
    const badgeText = stamped ? String(stamped.badge ?? '').trim() : 'DSH'
    const showName = stamped ? stamped.showName !== false : true
    const nameSize = String(value('nameSize', '17px'))
    const badgeBg = String(value('badgeBg', '#1b1f27'))
    const badgeFg = String(value('badgeFg', '#ffffff'))

    /**
     * The mark slot. The shell renders it with `size` (24 in both the expanded
     * row and the collapsed rail); `markSize` overrides that when set.
     *
     * `glyph` mode paints the image as a mask, so the mark takes `markColor`
     * (by default the theme's text color) with a transparent background — the
     * same treatment the stock DeepSeek whale gets. `image` mode keeps the
     * artwork's own colors.
     */
    function BrandMark(props) {
      const px = Number.isFinite(markSize) ? markSize : Number(props?.size) || 24
      if (markMode === 'image') {
        return h('img', {
          src: markSrc,
          alt: '',
          width: px,
          height: px,
          draggable: false,
          style: {
            width: px + 'px',
            height: px + 'px',
            display: 'block',
            objectFit: 'contain',
            borderRadius: markRadius,
          },
        })
      }
      const image = 'url("' + markSrc + '")'
      return h('span', {
        role: 'img',
        'aria-hidden': true,
        style: {
          display: 'block',
          width: px + 'px',
          height: px + 'px',
          backgroundColor: markColor,
          WebkitMaskImage: image,
          maskImage: image,
          WebkitMaskSize: 'contain',
          maskSize: 'contain',
          WebkitMaskRepeat: 'no-repeat',
          maskRepeat: 'no-repeat',
          WebkitMaskPosition: 'center',
          maskPosition: 'center',
        },
      })
    }

    /** The name slot: the wordmark plus an optional badge. */
    function BrandName() {
      if (!showName || (nameText === '' && badgeText === '')) return null
      return h(
        'span',
        {
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: nameSize,
            fontWeight: '600',
            letterSpacing: '-0.01em',
            lineHeight: '1.2',
            color: 'currentColor',
            whiteSpace: 'nowrap',
          },
        },
        nameText === '' ? null : h('span', { key: 'name' }, nameText),
        badgeText === ''
          ? null
          : h(
              'span',
              {
                key: 'badge',
                style: {
                  display: 'inline-block',
                  padding: '1px 5px 2px',
                  borderRadius: '4px',
                  background: badgeBg,
                  color: badgeFg,
                  fontSize: '9px',
                  fontWeight: '700',
                  letterSpacing: '0.08em',
                  lineHeight: '1.35',
                  textTransform: 'uppercase',
                },
              },
              badgeText,
            ),
      )
    }

    /**
     * Occupying a slot is the only composition route. A negative priority
     * shadows the official occupants (single slots render the lowest priority),
     * without having to disable their package.
     */
    function apply(ctx) {
      ctx.slots.inject('sidebar.brand.mark', () =>
        ctx.slots.inject('sidebar.brand.name', function* () {
          yield ctx.slots.register({ name: 'sidebar.brand.mark', priority: -1 }, BrandMark)
          yield ctx.slots.register({ name: 'sidebar.brand.name', priority: -1 }, BrandName)
        }),
      )
    }

    return { apply, inject: ['slots'] }
  },
})
