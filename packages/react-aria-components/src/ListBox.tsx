/*
 * Copyright 2022 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import {AriaListBoxOptions, DraggableItemResult, DroppableCollectionResult, DroppableItemResult, mergeProps, useHover, useListBox, useListBoxSection, useOption} from 'react-aria';
import {AriaListBoxProps} from '@react-types/listbox';
import {CollectionProps, ItemProps, useCachedChildren, useCollection} from './Collection';
import {ContextValue, Provider, SlotProps, StyleProps, StyleRenderProps, useContextProps, useRenderProps} from './utils';
import {DragAndDropHooks, DropIndicatorContext, DropIndicatorProps} from './useDragAndDrop';
import {DraggableCollectionState, DroppableCollectionState, ListState, OverlayTriggerState, useListState} from 'react-stately';
import {filterDOMProps, useObjectRef} from '@react-aria/utils';
import {isFocusVisible} from '@react-aria/interactions';
import {ListKeyboardDelegate} from '@react-aria/selection';
import {Node, SelectionBehavior} from '@react-types/shared';
import React, {createContext, ForwardedRef, forwardRef, RefObject, useContext, useRef} from 'react';
import {Separator, SeparatorContext} from './Separator';
import {TextContext} from './Text';

export interface ListBoxRenderProps {
  /**
   * Whether the listbox root is currently the active drop target.
   * @selector [data-drop-target]
   */
  isDropTarget?: boolean
}

export interface ListBoxProps<T> extends Omit<AriaListBoxProps<T>, 'children'>, CollectionProps<T>, StyleRenderProps<ListBoxRenderProps>, SlotProps {
  /** How multiple selection should behave in the collection. */
  selectionBehavior?: SelectionBehavior,
  /** The drag and drop hooks returned by `useDragAndDrop` used to enable drag and drop behavior for the ListBox. */
  dragAndDropHooks?: DragAndDropHooks
}

interface ListBoxContextValue<T> extends ListBoxProps<T> {
  state?: ListState<T> & OverlayTriggerState
}

interface InternalListBoxContextValue {
  state: ListState<unknown>,
  shouldFocusOnHover: boolean,
  dragAndDropHooks?: DragAndDropHooks,
  dragState?: DraggableCollectionState,
  dropState?: DroppableCollectionState
}

export const ListBoxContext = createContext<ContextValue<ListBoxContextValue<any>, HTMLDivElement>>(null);
const InternalListBoxContext = createContext<InternalListBoxContextValue>(null);

function ListBox<T>(props: ListBoxProps<T>, ref: ForwardedRef<HTMLDivElement>) {
  [props, ref] = useContextProps(props, ref, ListBoxContext);
  let state = (props as ListBoxContextValue<T>).state;

  if (state) {
    return state.isOpen ? <ListBoxInner state={state} props={props} listBoxRef={ref} /> : null;
  }
  
  return <ListBoxPortal props={props} listBoxRef={ref} />;
}

function ListBoxPortal({props, listBoxRef}) {
  let {portal, collection} = useCollection(props);
  props = {...props, collection, children: null, items: null};
  let state = useListState(props);
  return (
    <>
      {portal}
      <ListBoxInner state={state} props={props} listBoxRef={listBoxRef} />
    </>
  );
}

/**
 * A listbox displays a list of options and allows a user to select one or more of them.
 */
const _ListBox = forwardRef(ListBox);
export {_ListBox as ListBox};

interface ListBoxInnerProps<T> {
  state: ListState<T>,
  props: ListBoxProps<T> & AriaListBoxOptions<T>,
  listBoxRef: RefObject<HTMLDivElement>
}

function ListBoxInner<T>({state, props, listBoxRef}: ListBoxInnerProps<T>) {
  let {dragAndDropHooks} = props;
  let {collection, selectionManager} = state;
  let isListDraggable = !!dragAndDropHooks?.useDraggableCollectionState;
  let isListDroppable = !!dragAndDropHooks?.useDroppableCollectionState;
  let {listBoxProps} = useListBox({
    ...props,
    shouldSelectOnPressUp: isListDraggable || props.shouldSelectOnPressUp
  }, state, listBoxRef);

  let children = useCachedChildren({
    items: collection,
    children: (item: Node<T>) => {
      switch (item.type) {
        case 'section':
          return <ListBoxSection section={item} />;
        case 'separator':
          return <Separator {...item.props} />;
        case 'item':
          return <Option item={item} />;
        default:
          throw new Error('Unsupported node type in Menu: ' + item.type);
      }
    }
  });

  let dragHooksProvided = useRef(isListDraggable);
  let dropHooksProvided = useRef(isListDroppable);
  if (dragHooksProvided.current !== isListDraggable) {
    console.warn('Drag hooks were provided during one render, but not another. This should be avoided as it may produce unexpected behavior.');
  }
  if (dropHooksProvided.current !== isListDroppable) {
    console.warn('Drop hooks were provided during one render, but not another. This should be avoided as it may produce unexpected behavior.');
  }

  let dragState: DraggableCollectionState;
  let dropState: DroppableCollectionState;
  let droppableCollection: DroppableCollectionResult;
  let isRootDropTarget: boolean;
  let dragPreview: JSX.Element;
  let preview = useRef(null);

  if (isListDraggable) {
    dragState = dragAndDropHooks.useDraggableCollectionState({
      collection,
      selectionManager,
      preview: dragAndDropHooks.renderDragPreview ? preview : null
    });
    dragAndDropHooks.useDraggableCollection({}, dragState, listBoxRef);

    dragPreview = dragAndDropHooks.renderDragPreview
      ? <dragAndDropHooks.DragPreview ref={preview}>{dragAndDropHooks.renderDragPreview}</dragAndDropHooks.DragPreview>
      : null;
  }

  if (isListDroppable) {
    dropState = dragAndDropHooks.useDroppableCollectionState({
      collection,
      selectionManager
    });

    let keyboardDelegate = props.keyboardDelegate || new ListKeyboardDelegate(
      collection,
      selectionManager.disabledBehavior === 'selection' ? new Set() : selectionManager.disabledKeys,
      listBoxRef
    );
    let dropTargetDelegate = dragAndDropHooks.dropTargetDelegate || new dragAndDropHooks.ListDropTargetDelegate(collection, listBoxRef);
    droppableCollection = dragAndDropHooks.useDroppableCollection({
      keyboardDelegate,
      dropTargetDelegate
    }, dropState, listBoxRef);

    isRootDropTarget = dropState.isDropTarget({type: 'root'});
  }

  let renderProps = useRenderProps({
    className: props.className,
    style: props.style,
    defaultClassName: 'react-aria-ListBox',
    values: {
      isDropTarget: isRootDropTarget
    }
  });

  return (
    <div
      {...filterDOMProps(props)}
      {...mergeProps(listBoxProps, droppableCollection?.collectionProps)}
      {...renderProps}
      ref={listBoxRef}
      slot={props.slot}
      data-drop-target={isRootDropTarget || undefined}>
      <Provider
        values={[
          [InternalListBoxContext, {state, shouldFocusOnHover: props.shouldFocusOnHover, dragAndDropHooks, dragState, dropState}],
          [SeparatorContext, {elementType: 'li'}],
          [DropIndicatorContext, {render: ListBoxDropIndicator}]
        ]}>
        {children}
      </Provider>
      {dragPreview}
    </div>
  );
}

interface ListBoxSectionProps<T> extends StyleProps {
  section: Node<T>
}

function ListBoxSection<T>({section, className, style, ...otherProps}: ListBoxSectionProps<T>) {
  let {headingProps, groupProps} = useListBoxSection({
    heading: section.rendered,
    'aria-label': section['aria-label']
  });

  let children = useCachedChildren({
    items: section.childNodes,
    children: item => {
      if (item.type !== 'item') {
        throw new Error('Only items are allowed within a section');
      }

      return <Option item={item} />;
    }
  });

  return (
    <section 
      {...filterDOMProps(otherProps)}
      {...groupProps}
      className={className || section.props?.className || 'react-aria-Section'}
      style={style || section.props?.style}>
      {section.rendered &&
        <header {...headingProps}>
          {section.rendered}
        </header>
      }
      {children}
    </section>
  );
}

interface OptionProps<T> {
  item: Node<T>
}

function Option<T>({item}: OptionProps<T>) {
  let ref = useRef();
  let {state, shouldFocusOnHover, dragAndDropHooks, dragState, dropState} = useContext(InternalListBoxContext);
  let {optionProps, labelProps, descriptionProps, ...states} = useOption(
    {key: item.key},
    state,
    ref
  );

  let {hoverProps, isHovered} = useHover({
    isDisabled: shouldFocusOnHover || (!states.allowsSelection && !states.hasAction)
  });

  if (shouldFocusOnHover) {
    hoverProps = {};
    isHovered = states.isFocused;
  }

  let draggableItem: DraggableItemResult;
  if (dragState) {
    draggableItem = dragAndDropHooks.useDraggableItem({key: item.key}, dragState);
  }

  let droppableItem: DroppableItemResult;
  if (dropState) {
    droppableItem = dragAndDropHooks.useDroppableItem({
      target: {type: 'item', key: item.key, dropPosition: 'on'}
    }, dropState, ref);
  }

  let props: ItemProps<T> = item.props;
  let focusVisible = states.isFocused && isFocusVisible();
  let isDragging = dragState && dragState.isDragging(item.key);
  let renderProps = useRenderProps({
    ...props,
    children: item.rendered,
    defaultClassName: 'react-aria-Item',
    values: {
      ...states,
      isHovered,
      isFocusVisible: focusVisible,
      selectionMode: state.selectionManager.selectionMode,
      selectionBehavior: state.selectionManager.selectionBehavior,
      isDragging,
      isDropTarget: droppableItem?.isDropTarget
    }
  });

  let renderDropIndicator = dragAndDropHooks?.renderDropIndicator || (target => <ListBoxDropIndicator target={target} />);

  return (
    <>
      {dragAndDropHooks?.useDropIndicator &&
        renderDropIndicator({type: 'item', key: item.key, dropPosition: 'before'})
      }
      <div
        {...mergeProps(optionProps, hoverProps, draggableItem?.dragProps, droppableItem?.dropProps)}
        {...renderProps}
        ref={ref}
        data-hovered={isHovered || undefined}
        data-focused={states.isFocused || undefined}
        data-focus-visible={focusVisible || undefined}
        data-pressed={states.isPressed || undefined}
        data-dragging={isDragging || undefined}
        data-drop-target={droppableItem?.isDropTarget || undefined}>
        <Provider
          values={[
            [TextContext, {
              slots: {
                label: labelProps,
                description: descriptionProps
              }
            }]
          ]}>
          {renderProps.children}
        </Provider>
      </div>
      {dragAndDropHooks?.useDropIndicator && state.collection.getKeyAfter(item.key) == null &&
        renderDropIndicator({type: 'item', key: item.key, dropPosition: 'after'})
      }
    </>
  );
}

function ListBoxDropIndicator(props: DropIndicatorProps, ref: ForwardedRef<HTMLElement>) {
  ref = useObjectRef(ref);
  let {dragAndDropHooks, dropState} = useContext(InternalListBoxContext);
  let {dropIndicatorProps, isHidden, isDropTarget} = dragAndDropHooks.useDropIndicator(
    props,
    dropState,
    ref
  );

  if (isHidden) {
    return null;
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  let renderProps = useRenderProps({
    ...props,
    defaultClassName: 'react-aria-DropIndicator',
    values: {
      isDropTarget
    }
  });

  return (
    <li
      {...dropIndicatorProps}
      {...renderProps}
      // eslint-disable-next-line
      role="option"
      ref={ref as RefObject<HTMLLIElement>}
      data-drop-target={isDropTarget || undefined} />
  );
}
